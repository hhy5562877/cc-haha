"""批次 23 收尾 v4：全仓裸 AgentTool/ 相对引用精算重指。执行后删除本脚本。"""
import os
import re

NEW_ABS = os.path.abspath('src/server/tools/AgentTool')
PAT = re.compile(r"(['\"])((?:\./|\.\./)+(?:\.\./)*)AgentTool/([A-Za-z0-9_./-]+)\1")
n = 0
for root, dirs, files in os.walk('src'):
    dirs[:] = [d for d in dirs if d != 'node_modules']
    for fn in files:
        if not fn.endswith(('.ts', '.tsx')):
            continue
        p = os.path.join(root, fn)
        norm = p.replace('\\', '/')
        if norm.startswith('src/server/tools/AgentTool'):
            continue
        fdir = os.path.dirname(p)
        s = open(p, encoding='utf-8').read()
        o = s

        def repl(m):
            global n
            q, tail = m.group(1), m.group(3)
            sub = tail
cands = [sub]
            if sub.endswith('.js'):
                cands = [sub[:-3] + '.ts', sub[:-3] + '.tsx', sub]
            t = None
            for c in cands:
                a = os.path.join(NEW_ABS, c.replace('/', os.sep))
                if os.path.isfile(a):
                    t = a
                    break
            if t is None:
                return m.group(0)
            n += 1
            r = os.path.relpath(t, fdir).replace(os.sep, '/')
            if r.endswith('.ts'):
                r = r[:-3] + '.js'
            elif r.endswith('.tsx'):
                r = r[:-4] + '.js'
            if not r.startswith('.'):
                r = './' + r
            return q + r + q

        s = PAT.sub(repl, s)
        if s != o:
            open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('bare fixed:', n)
