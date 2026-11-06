#!/usr/bin/env python3
"""Read-only asset compatibility check; does not rebuild, sign or install APKs."""
import argparse
import hashlib
import pathlib
import subprocess
import tempfile
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
RESOURCE = ROOT / 'patches/src/main/resources/greatday8'
PREVIEW = 'this.defaultTimeoutAtt=5}ngOnInit(){'
OFFLINE = 'ngOnInit(){this.params=this.navigationService.getParams()||this.navParams.get("params")}'


def once(text, anchor, replacement):
    if text.count(anchor) != 1:
        raise ValueError(f'Expected exactly one hook: {anchor}')
    return text.replace(anchor, replacement)


def transform(path, text):
    if path.endswith('index.html'):
        return once(text, '</head>', '<script src="dika/core.js"></script><script src="dika/runtime.js"></script></head>')
    if '61543.' in path:
        return text  # Fingerprinted dependency, never modified.
    text = once(text, PREVIEW, PREVIEW + 'globalThis.DikaOffline?.attachPreview(this);')
    if '86035.' not in path:
        text = once(text, OFFLINE, OFFLINE[:-1] + ';globalThis.DikaOffline?.attachOffline(this);}')
        argument, receiver, record = ('f', 'v', 'b') if '19123.' in path else ('m', 'd', 'E')
        text = once(text, f'recordAttendance({argument}){{var {receiver}=this;',
                    f'recordAttendance({argument}){{const __dikaTicket=globalThis.DikaOffline?.ticketFor(this);var {receiver}=this;')
        text = once(text, f'{record}.attOn="offline",{receiver}.navigationService.pushSide(',
                    f'{record}.attOn="offline",globalThis.DikaOffline?.captured(__dikaTicket,{record}),{receiver}.navigationService.pushSide(')
    return text


def check(apk):
    expected = dict(line.split('=', 1) for line in (RESOURCE / 'targets.properties').read_text().splitlines() if line)
    with zipfile.ZipFile(apk) as archive, tempfile.TemporaryDirectory() as temp:
        for index, (path, digest) in enumerate(expected.items()):
            data = archive.read(path)
            if hashlib.sha256(data).hexdigest() != digest:
                raise ValueError(f'Unsupported APK content: {path}')
            transformed = transform(path, data.decode('utf-8'))
            if path.endswith('.js'):
                target = pathlib.Path(temp, f'chunk-{index}.js')
                target.write_text(transformed)
                subprocess.run(['node', '--check', str(target)], check=True)
            print(f'PASS {path}')
    print('Asset fingerprints, unique hooks, and modified JavaScript syntax passed. Device behavior is NOT verified.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('apk', type=pathlib.Path)
    check(parser.parse_args().apk)
