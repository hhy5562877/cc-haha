"""语义归一器（通用复用版）：搬迁目录内全部相对说明符按原目录语义重算。
用法：python scripts/semantic-normalize.py <新目录> <原目录>
含污染恢复（../../../../ 错插逆推）。执行后删除本脚本。"""
import os
import re
import sys

CUR = os.path.abspath(sys.argv[1])
ORIG = os.path.abspath(sys.argv[2])
SRC_ABS = os.path.abspath('src')
EXTS = ('', '.ts', '.tsx', '.js', '.json')
patched = 0

for root, dirs, files in os.walk(CUR):
    for fn in files:
        if not fn.endswith(('.ts', '.tsx')):
            continue
        path = os.path.join(root, fn)
        s = open(path, encoding='utf-8').read()
        original = s
        out = []
        for line in s.split('\n'):
            if ("from '" not in line) and ('import(' not in line) and ('require(' not in line):
                out.append(line)
                continue
            nl = line
            for m in list(re.finditer(r"['\"](\.\.?/[^'\"]+)['\"]", line)):
                spec = m.group(1)
                base = spec
                for ext in ('.js', '.tsx'):
                    if base.endswith(ext):
                        base = base[:-len(ext)]
                        break
                target = None
                if base.startswith('./'):
                    c = os.path.normpath(os.path.join(CUR, base[2:]))
                    for ext in EXTS:
                        if os.path.isfile(c + ext):
                            target = c + ext
                            break
                else:
                    for intent_base in (base, base.replace('../../../../', '../../', 1)):
                        c = os.path.normpath(os.path.join(ORIG, intent_base))
                        if not c.startswith(SRC_ABS):
                            continue
                        hit = None
                        for ext in EXTS:
                            if os.path.isfile(c + ext):
                                hit = c + ext
                                break
                        if hit is None and os.path.isdir(c) and os.path.isfile(os.path.join(c, 'index.ts')):
                            hit = os.path.join(c, 'index.ts')
                        if hit is not None:
                            target = hit
                            break
                if target is None:
                    continue
                rel = os.path.relpath(target, os.path.dirname(path)).replace(os.sep, '/')
                if rel.endswith('.ts'):
                    rel = rel[:-3] + '.js'
                elif rel.endswith('.tsx'):
                    rel = rel[:-4] + '.js'
                if not rel.startswith('.'):
                    rel = './' + rel
                nl = nl.replace(m.group(0), "'" + rel + "'")
            out.append(nl)
        new_s = '\n'.join(out)
        if new_s != original:
            open(path, 'w', encoding='utf-8', newline='\n').write(new_s)
            patched += 1
            print('patched', os.path.relpath(path))

print('patched files:', patched)
