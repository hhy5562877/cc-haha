"""通用：引擎目录整体搬迁后的全仓说明符重指。
用法：python scripts/repoint-moved-dir.py services/openaiAuth server/services/openaiAuth
处理四类形态：相对前缀引用、src/utils 内 ./ 组引用、搬迁件自身父级深度、
根式 src/<old>/ 引用。仅当新位置文件存在时改写。执行后删除本脚本。"""
import os
import re
import sys

OLD_REL = sys.argv[1] if len(sys.argv) > 1 else 'services/openaiAuth'
NEW_REL = sys.argv[2] if len(sys.argv) > 2 else 'server/services/openaiAuth'

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(REPO, 'src')
NEW_ROOT = os.path.join(SRC, NEW_REL.replace('/', os.sep))
OLD_TAIL = OLD_REL.split('/')[-1]  # 组名，如 openaiAuth
EXTS = ('.ts', '.tsx', '.js', '.mjs', '.json', '')
fixed = 0


def exists_at(abs_no_ext):
    for ext in EXTS:
        p = abs_no_ext + ext
        if os.path.isfile(p):
            return p
    idx = os.path.join(abs_no_ext, 'index.ts')
    if os.path.isfile(idx):
        return idx
    return None


def rel_import(path, abs_target):
    rel = os.path.relpath(abs_target, os.path.dirname(path)).replace('\\', '/')
    if rel.endswith('.ts'):
        rel = rel[:-3] + '.js'
    elif rel.endswith('.tsx'):
        rel = rel[:-4] + '.js'
    if not rel.startswith('.'):
        rel = './' + rel
    return rel


for root, dirs, files in os.walk(SRC):
    dirs[:] = [d for d in dirs if d != 'node_modules']
    for fn in files:
        if not fn.endswith(('.ts', '.tsx')):
            continue
        path = os.path.join(root, fn)
        rel = os.path.relpath(path, REPO).replace('\\', '/')
        in_moved = rel.startswith(OLD_REL.split('/')[0] + '/' + '/'.join(OLD_REL.split('/')[1:]))
        file_dir = os.path.dirname(path)
        s = open(path, encoding='utf-8').read()
        original = s

        # 1) 搬迁件自身：父级深度 +1（../../ → ../../../），单父 ../ → ../<old-first>/ 前身目录
        if rel.startswith(NEW_REL.rsplit('/', 1)[0] + '/' + OLD_TAIL + '/') or rel.startswith(NEW_REL + '/'):
            s = s.replace("from '../../", "from '../../../")
            s = s.replace("('../../", "( '../../../")
            s = s.replace("from '../", "from '../../../" + OLD_REL.split('/')[0] + "/")
            s = s.replace("('../", "('../../../" + OLD_REL.split('/')[0] + "/")

        # 2) 引用方：相对说明符指向旧组
        pat = re.compile(
            r"(['\"])((?:\./)?(?:\.\./)+(?:[A-Za-z0-9_.-]+/)*" + re.escape(OLD_REL) + r"/[A-Za-z0-9_./-]+)\1"
        )

        def repl_ref(match):
            global fixed
            quote, body = match.group(1), match.group(2)
            sub = body.split(OLD_REL + '/', 1)[1]
            base_no_ext = os.path.join(NEW_ROOT, sub.replace('/', os.sep))
            resolved = exists_at(base_no_ext)
            if resolved is None:
                return match.group(0)
            fixed += 1
            return quote + rel_import(path, resolved) + quote

        s = pat.sub(repl_ref, s)

        # 3) src/utils 兄弟：./<old-tail>/x（旧组直接在 src/utils 下时）
        if OLD_REL.startswith('utils/') and rel.startswith('src/utils/') and not rel.startswith('src/utils/' + OLD_TAIL):
            pat_sib = re.compile(r"(['\"])\./(" + re.escape(OLD_TAIL) + r"/[A-Za-z0-9_./-]+)\1")

            def repl_sib(match):
                global fixed
                sub = match.group(2)
                base_no_ext = os.path.join(NEW_ROOT, sub.replace('/', os.sep))
                resolved = exists_at(base_no_ext)
                if resolved is None:
                    return match.group(0)
                fixed += 1
                return match.group(1) + rel_import(path, resolved) + match.group(1)

            s = pat_sib.sub(repl_sib, s)

        # 4) 根式 'src/<old>/x'
        pat_root = re.compile(r"(['\"])src/" + re.escape(OLD_REL) + r"/([A-Za-z0-9_./-]+)\1")

        def repl_root(match):
            global fixed
            sub = match.group(2)
            base_no_ext = os.path.join(NEW_ROOT, sub.replace('/', os.sep))
            resolved = exists_at(base_no_ext)
            if resolved is None:
                return match.group(0)
            fixed += 1
            return match.group(1) + 'src/' + NEW_REL + '/' + sub + match.group(1)

        s = pat_root.sub(repl_root, s)

        if s != original:
            open(path, 'w', encoding='utf-8', newline='\n').write(s)
            print('fixed', rel)

print('total fixed:', fixed)
