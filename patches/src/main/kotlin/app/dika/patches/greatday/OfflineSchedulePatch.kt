/* SPDX-License-Identifier: GPL-3.0-only */
package app.dika.patches.greatday

import app.morphe.patcher.patch.ApkFileType
import app.morphe.patcher.patch.AppTarget
import app.morphe.patcher.patch.Compatibility
import app.morphe.patcher.patch.resourcePatch
import java.security.MessageDigest
import java.util.Properties

private const val PREVIEW_ANCHOR = "this.defaultTimeoutAtt=5}ngOnInit(){"
private const val OFFLINE_INIT = "ngOnInit(){this.params=this.navigationService.getParams()||this.navParams.get(\"params\")}"
private const val INDEX = "assets/public/index.html"
private const val SHARED = "assets/public/61543.79fad183692bc090.js"
private const val MACHINE_ANCHOR = "this.livenessGestureStatus=!1}get googlePlayServicesAvailable(){"
private const val NAV_ANCHOR = "this.previousRouteData=\"\"}get previousRoute(){"

val offlineSchedulePatch = resourcePatch(
    name = "Scheduled offline attendance (experimental)",
    description = "WITA schedules for the original offline flow on connected or disconnected devices. Includes isolated GreatDay-themed settings and native reminder fallback.",
) {
    compatibleWith(Compatibility(
        name = "GreatDay 8",
        packageName = "com.greatday.app",
        apkFileType = ApkFileType.APK,
        appIconColor = 0xFF7A00,
        targets = listOf(AppTarget(version = "1.79.1", isExperimental = true)),
    ))

    execute {
        fun resource(name: String): String = checkNotNull(
            object {}.javaClass.getResourceAsStream("/greatday8/$name")
        ) { "Missing bundled resource: $name" }.bufferedReader(Charsets.UTF_8).use { it.readText() }

        val fingerprints = Properties().apply { load(resource("targets.properties").reader()) }
        // Validate EVERYTHING before changing any asset. A version label alone
        // cannot identify this manually relabelled APK.
        for (path in fingerprints.stringPropertyNames()) {
            val file = get(path, true)
            check(file.isFile) { "Unsupported APK: missing $path" }
            val hash = MessageDigest.getInstance("SHA-256").digest(file.readBytes())
                .joinToString("") { "%02x".format(it.toInt() and 0xff) }
            check(hash == fingerprints.getProperty(path)) { "Unsupported APK content: $path. No files changed." }
        }
        val replacements = linkedMapOf<String, String>()
        fun exactlyOnce(text: String, anchor: String): Boolean {
            val first = text.indexOf(anchor)
            return first >= 0 && text.indexOf(anchor, first + anchor.length) < 0
        }
        for (path in fingerprints.stringPropertyNames().filter {
            it.endsWith(".js")
        }) {
            var content = get(path, true).readText()
            fun hook(anchor: String, replacement: String) {
                check(exactlyOnce(content, anchor)) { "Ambiguous hook: $path" }
                content = content.replace(anchor, replacement)
            }
            if (path == SHARED) {
                hook(MACHINE_ANCHOR, "this.livenessGestureStatus=!1;globalThis.DikaOffline?.attachMachine(this);}get googlePlayServicesAvailable(){")
                hook(NAV_ANCHOR, "this.previousRouteData=\"\";globalThis.DikaOffline?.attachNavigation(this);}get previousRoute(){")
            } else {
                hook(PREVIEW_ANCHOR, "${PREVIEW_ANCHOR}globalThis.DikaOffline?.attachPreview(this);")
            }
            if (path != SHARED && !path.contains("86035.")) {
                hook(OFFLINE_INIT, OFFLINE_INIT.dropLast(1) + ";globalThis.DikaOffline?.attachOffline(this);}")
                val (argument, receiver, record) = if (path.contains("19123."))
                    Triple("f", "v", "b") else Triple("m", "d", "E")
                val method = "recordAttendance($argument){var $receiver=this;"
                hook(method, "recordAttendance($argument){const __dikaTicket=globalThis.DikaOffline?.ticketFor(this);var $receiver=this;")
                val captured = "$record.attOn=\"offline\",$receiver.navigationService.pushSide("
                hook(captured, "$record.attOn=\"offline\",globalThis.DikaOffline?.captured(__dikaTicket,$record),$receiver.navigationService.pushSide(")
            }
            replacements[path] = content
        }
        val html = get(INDEX, true).readText()
        check(exactlyOnce(html, "</head>")) { "Unsupported index document" }
        replacements[INDEX] = html.replace("</head>",
            "<script src=\"dika/core.js\"></script><script src=\"dika/runtime.js\"></script><script src=\"dika/ui.js\"></script></head>")
        // Read all bundled code before applying the transformation.
        val core = resource("core.js")
        val runtime = resource("runtime.js")
        val ui = resource("ui.js")
        get("assets/public/dika/core.js", false).apply { parentFile.mkdirs(); writeText(core) }
        get("assets/public/dika/runtime.js", false).apply { parentFile.mkdirs(); writeText(runtime) }
        get("assets/public/dika/ui.js", false).apply { parentFile.mkdirs(); writeText(ui) }
        replacements.forEach { (path, content) -> get(path, true).writeText(content) }
    }
}
