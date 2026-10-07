"""
Automated Windows Build & Packaging Script for QA Device Agent.
Builds standalone binary via PyInstaller and creates zip / distribution folder.
"""
import os
import sys
import subprocess
import shutil

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DIST_DIR = os.path.join(ROOT_DIR, "dist")
BUILD_DIR = os.path.join(ROOT_DIR, "build")
PACKAGE_OUTPUT = os.path.join(ROOT_DIR, "dist", "package_windows")


def clean():
    print("[*] Cleaning previous build artifacts...")
    for d in [DIST_DIR, BUILD_DIR]:
        if os.path.exists(d):
            shutil.rmtree(d, ignore_errors=True)


def build_pyinstaller():
    print("[*] Running PyInstaller build...")
    cmd = [
        sys.executable,
        "-m", "PyInstaller",
        "--noconfirm",
        "--clean",
        os.path.join(ROOT_DIR, "qa_device_agent.spec")
    ]
    res = subprocess.run(cmd, cwd=ROOT_DIR)
    if res.returncode != 0:
        print(f"[-] PyInstaller build failed with exit code {res.returncode}")
        return False
    print("[+] PyInstaller standalone binary bundled successfully.")
    return True


def package_windows():
    print("[*] Packaging Windows distribution...")
    os.makedirs(PACKAGE_OUTPUT, exist_ok=True)
    
    agent_dist = os.path.join(DIST_DIR, "qa-device-agent")
    if not os.path.exists(agent_dist):
        print(f"[-] Error: {agent_dist} not found.")
        return False

    dest = os.path.join(PACKAGE_OUTPUT, "qa-device-agent")
    if os.path.exists(dest):
        shutil.rmtree(dest)
    shutil.copytree(agent_dist, dest)

    # Copy Windows launcher and README
    launcher_src = os.path.join(ROOT_DIR, "package", "windows", "qa-device-agent.bat")
    if os.path.exists(launcher_src):
        shutil.copy(launcher_src, os.path.join(PACKAGE_OUTPUT, "qa-device-agent.bat"))

    # Create zip archive
    zip_path = os.path.join(DIST_DIR, "QA-Device-Agent-Windows-x64-v1.1.2")
    shutil.make_archive(zip_path, "zip", PACKAGE_OUTPUT)
    print(f"[+] Windows distribution created: {zip_path}.zip")
    return True


def main():
    print("==================================================")
    print("     QA DEVICE AGENT - WINDOWS BUILD PIPELINE     ")
    print("==================================================")
    clean()
    if not build_pyinstaller():
        sys.exit(1)
    if not package_windows():
        sys.exit(1)
    print("[+] Windows packaging complete!")


if __name__ == "__main__":
    main()
