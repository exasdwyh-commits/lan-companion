# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML==6.0.3"]
# ///
"""BMAD audit regressions use temporary installation fixtures only."""

import csv
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

PROJECT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("check_bmad", PROJECT / "scripts/check-bmad.py")
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)


class BmadSetupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="bmad-setup-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        for relative in ("_bmad/_config", "_bmad/scripts", "_bmad/custom"):
            (self.root / relative).mkdir(parents=True)
        for name in ("config_utils.py", "resolve_config.py"):
            shutil.copyfile(PROJECT / "_bmad/scripts" / name, self.root / "_bmad/scripts" / name)
        (self.root / "_bmad/_config/manifest.yaml").write_text(
            "installation:\n  version: 6.12.4\nides:\n  - codex\n  - codebuddy\n", encoding="utf-8")
        self.catalog = self.root / "_bmad/_config/skill-manifest.csv"
        with self.catalog.open("w", newline="", encoding="utf-8") as stream:
            writer = csv.writer(stream)
            writer.writerow(["canonicalId", "name", "module", "path"])
            for name in sorted(AUDIT.REQUIRED_SKILLS):
                writer.writerow([name, name, "bmm", f"_bmad/bmm/{name}/SKILL.md"])
                for folder in (".agents/skills", ".codebuddy/skills"):
                    skill = self.root / folder / name / "SKILL.md"
                    skill.parent.mkdir(parents=True)
                    skill.write_text(f"---\nname: {name}\ndescription: Use when testing BMAD setup.\n---\n技能说明。\n", encoding="utf-8")
        (self.root / "_bmad/config.toml").write_text(
            '[core]\ncommunication_language="Chinese"\ndocument_output_language="Chinese"\n'
            'output_folder="docs/project/bmad"\n[modules.bmm]\n'
            'planning_artifacts="{project-root}/docs/project/bmad/planning-artifacts"\n'
            'implementation_artifacts="{project-root}/docs/project/bmad/implementation-artifacts"\n'
            'project_knowledge="docs/project"\n', encoding="utf-8")

    def check(self):
        return AUDIT.check_setup(self.root)

    def test_valid_installation_is_read_only(self):
        before = {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob("*") if p.is_file()}
        self.assertTrue(self.check()["ok"])
        after = {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob("*") if p.is_file()}
        self.assertEqual(before, after)

    def test_wrong_version_fails(self):
        manifest = self.root / "_bmad/_config/manifest.yaml"
        manifest.write_text(manifest.read_text().replace("6.12.4", "7.0.0"))
        self.assertFalse(self.check()["ok"])

    def test_missing_skill_fails(self):
        (self.root / ".agents/skills/bmad-build/SKILL.md").unlink()
        self.assertIn("缺少技能：codex/bmad-build/SKILL.md", self.check()["errors"])

    def test_missing_codebuddy_skill_fails(self):
        (self.root / ".codebuddy/skills/bmad-build/SKILL.md").unlink()
        self.assertIn("缺少技能：codebuddy/bmad-build/SKILL.md", self.check()["errors"])

    def test_codex_in_unrelated_yaml_field_does_not_count(self):
        (self.root / "_bmad/_config/manifest.yaml").write_text(
            'installation:\n  version: 6.12.4\nides:\n  - codebuddy\nother:\n  - codex\n', encoding="utf-8")
        self.assertIn("安装清单未登记 codex。", self.check()["errors"])

    def test_missing_codebuddy_registration_fails(self):
        manifest = self.root / "_bmad/_config/manifest.yaml"
        manifest.write_text(manifest.read_text().replace("  - codebuddy\n", ""))
        self.assertIn("安装清单未登记 codebuddy。", self.check()["errors"])

    def test_quoted_version_with_comment_is_valid(self):
        manifest = self.root / "_bmad/_config/manifest.yaml"
        manifest.write_text(manifest.read_text().replace("version: 6.12.4", 'version: "6.12.4" # pinned'))
        self.assertTrue(self.check()["ok"])

    def test_empty_description_fails(self):
        skill = self.root / ".agents/skills/bmad-build/SKILL.md"
        skill.write_text('---\nname: bmad-build\ndescription: ""\n---\n说明\n', encoding="utf-8")
        self.assertFalse(self.check()["ok"])

    def test_unclosed_frontmatter_quote_fails(self):
        skill = self.root / ".agents/skills/bmad-build/SKILL.md"
        skill.write_text('---\nname: "bmad-build\ndescription: nonempty\n---\n说明\n', encoding="utf-8")
        self.assertFalse(self.check()["ok"])

    def test_invalid_catalog_fails(self):
        self.catalog.write_text("broken,catalog\n", encoding="utf-8")
        self.assertFalse(self.check()["ok"])

    def test_path_traversal_in_skill_id_fails(self):
        with self.catalog.open("a", encoding="utf-8") as stream:
            stream.write("../../outside,../../outside,bmm,ignored\n")
        self.assertFalse(self.check()["ok"])

    def test_personal_override_is_merged(self):
        (self.root / "_bmad/custom/config.user.toml").write_text(
            '[core]\ncommunication_language="English"\n', encoding="utf-8")
        self.assertIn("core.communication_language 应为 Chinese。", self.check()["errors"])

    def test_external_output_path_fails(self):
        (self.root / "_bmad/custom/config.toml").write_text(
            '[core]\noutput_folder="../outside"\n', encoding="utf-8")
        self.assertFalse(self.check()["ok"])

    def test_malformed_toml_fails_without_traceback(self):
        (self.root / "_bmad/custom/config.toml").write_text("[broken", encoding="utf-8")
        self.assertIn("官方配置解析器失败；检查 _bmad 的四层 TOML 配置及脚本是否完整。", self.check()["errors"])

    def test_cli_failure_has_nonzero_exit_and_json(self):
        (self.root / ".agents/skills/bmad-help/SKILL.md").unlink()
        result = subprocess.run([sys.executable, "-B", str(PROJECT / "scripts/check-bmad.py"),
                                 "--project-root", str(self.root), "--json"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertFalse(json.loads(result.stdout)["ok"])
        self.assertNotIn("Traceback", result.stderr)


if __name__ == "__main__":
    unittest.main()
