#!/usr/bin/env python3
"""PARSEUR 10X v2 Engine deploy script.
Creates a clean zip, then prints exact GitHub + Netlify commands.
Run from the project root on the iMac: python3 deploy.py
"""
import os, subprocess, sys, zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
EXCLUDE_DIRS = {"node_modules", ".git", "data", "__pycache__"}
ZIP_NAME = "parseur10x-v2-engine.zip"
REPO = "lecorbeaured/parseur10x-v2-engine"
SITE_NAME = "parseur10x-v2-engine"

def make_zip():
    zpath = os.path.join(ROOT, ZIP_NAME)
    if os.path.exists(zpath):
        os.remove(zpath)
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for dirpath, dirnames, filenames in os.walk(ROOT):
            dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
            for f in filenames:
                if f == ZIP_NAME:
                    continue
                full = os.path.join(dirpath, f)
                z.write(full, os.path.relpath(full, ROOT))
    print(f"[ok] wrote {ZIP_NAME}")

def have(cmd):
    return subprocess.call(["which", cmd], stdout=subprocess.DEVNULL) == 0

def main():
    make_zip()
    print("\n--- Next steps ---")
    if have("gh"):
        print(f"1) gh repo create {REPO} --public --source . --push")
    else:
        print(f"1) Create repo {REPO} on GitHub, then:")
        print("   git init && git add -A && git commit -m 'v2 engine prototype' && git branch -M main")
        print(f"   git remote add origin https://github.com/{REPO}.git && git push -u origin main")
    if have("netlify"):
        print(f"2) netlify deploy --prod --dir . --site {SITE_NAME}   (demo at /demo/)")
    else:
        print("2) Netlify: drag the project folder into app.netlify.com/drop, or install CLI: npm i -g netlify-cli")
    print("3) Eval check: node test/run-eval.js 50 8")
    print("4) LLM mode: export OPENROUTER_API_KEY=...  (key lives in the secrets vault)")

if __name__ == "__main__":
    main()
