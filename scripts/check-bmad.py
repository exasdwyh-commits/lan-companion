#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML==6.0.3"]
# ///
"""Read-only audit of this project's pinned BMAD Codex installation."""

import argparse
import csv
import json
from pathlib import Path
import re
import subprocess
import sys

sys.dont_write_bytecode = True

import yaml

EXPECTED_VERSION = "6.12.4"
TOOLS = {"codex": ".agents/skills", "codebuddy": ".codebuddy/skills"}
REQUIRED_SKILLS = {
    "bmad-help", "bmad-prd", "bmad-architecture", "bmad-create-epics-and-stories",
    "bmad-sprint-planning", "bmad-build", "bmad-code-review", "bmad-qa-generate-e2e-tests",
}


def check_setup(root: Path) -> dict:
    root = root.resolve()
    errors = []
    names = set()
    try:
        manifest = yaml.safe_load((root / "_bmad/_config/manifest.yaml").read_text(encoding="utf-8"))
        if manifest.get("installation", {}).get("version") != EXPECTED_VERSION:
            errors.append(f"BMAD 版本应为 {EXPECTED_VERSION}；请使用文档中的固定版本安装命令。")
        configured_tools = manifest.get("ides")
        if not isinstance(configured_tools, list):
            raise ValueError("ides 必须是工具列表")
        for tool in TOOLS:
            if tool not in configured_tools:
                errors.append(f"安装清单未登记 {tool}。")
        with (root / "_bmad/_config/skill-manifest.csv").open(encoding="utf-8", newline="") as stream:
            reader = csv.DictReader(stream)
            if not {"canonicalId", "name", "module", "path"}.issubset(reader.fieldnames or []):
                raise ValueError("技能清单缺少必需列")
            for row in reader:
                name = row.get("canonicalId") or ""
                if not re.fullmatch(r"bmad(?:-[a-z0-9]+)+", name) or name in names or row.get("name") != name:
                    raise ValueError("技能清单包含非法、重复或不一致的标识")
                names.add(name)
                for tool, folder in TOOLS.items():
                    skill = root / folder / name / "SKILL.md"
                    if not skill.is_file():
                        errors.append(f"缺少技能：{tool}/{name}/SKILL.md")
                        continue
                    content = skill.read_text(encoding="utf-8")
                    parts = re.split(r"(?m)^---[ \t]*\r?$", content, maxsplit=2)
                    if len(parts) != 3 or parts[0].strip() or not parts[2].strip():
                        errors.append(f"技能内容或 frontmatter 不完整：{tool}/{name}")
                        continue
                    frontmatter = yaml.safe_load(parts[1])
                    description = frontmatter.get("description") if isinstance(frontmatter, dict) else None
                    if not isinstance(frontmatter, dict) or frontmatter.get("name") != name or not isinstance(description, str) or not description.strip():
                        errors.append(f"技能名称或描述不完整：{tool}/{name}")
        missing = REQUIRED_SKILLS - names
        if missing:
            errors.append("技能清单缺少工作流入口：" + ", ".join(sorted(missing)))
        resolver = root / "_bmad/scripts/resolve_config.py"
        resolved = subprocess.run(
            [sys.executable, "-B", str(resolver), "--project-root", str(root)],
            capture_output=True, text=True, timeout=20,
        )
        if resolved.returncode:
            errors.append("官方配置解析器失败；检查 _bmad 的四层 TOML 配置及脚本是否完整。")
        else:
            config = json.loads(resolved.stdout)
            core = config.get("core", {})
            bmm = config.get("modules", {}).get("bmm", {})
            for key in ("communication_language", "document_output_language"):
                if core.get(key) != "Chinese":
                    errors.append(f"core.{key} 应为 Chinese。")
            paths = {
                "core.output_folder": (core.get("output_folder"), root / "docs/project/bmad"),
                "bmm.planning_artifacts": (bmm.get("planning_artifacts"), root / "docs/project/bmad/planning-artifacts"),
                "bmm.implementation_artifacts": (bmm.get("implementation_artifacts"), root / "docs/project/bmad/implementation-artifacts"),
                "bmm.project_knowledge": (bmm.get("project_knowledge"), root / "docs/project"),
            }
            for key, (value, expected) in paths.items():
                if not isinstance(value, str) or not value.strip():
                    errors.append(f"{key} 缺失或类型错误。")
                    continue
                actual = (root / value.replace("{project-root}", str(root))).resolve()
                if actual != expected.resolve():
                    errors.append(f"{key} 未指向约定的项目文档路径。")
    except (OSError, ValueError, csv.Error, subprocess.TimeoutExpired, AttributeError, TypeError, yaml.YAMLError):
        errors.append("BMAD 安装文件或配置无法读取/解析；检查清单、技能及 TOML 类型。")
    return {"ok": not errors, "expected_version": EXPECTED_VERSION, "skill_count": len(names), "tools": list(TOOLS), "errors": errors}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    result = check_setup(args.project_root)
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    elif result["ok"]:
        print(f"PASS：BMAD {EXPECTED_VERSION}，Codex/CodeBuddy 各 {result['skill_count']} 个技能，中文配置与文档路由正确。")
    else:
        for error in result["errors"]:
            print(f"FAIL：{error}")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
