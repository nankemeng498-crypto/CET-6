"""运行：python -B -m unittest discover -s tools -p 'test_*.py'。"""
import json
import contextlib
import io
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from convert_cet_vocab import FIELDS, convert, main


class ConversionTests(unittest.TestCase):
    def test_legacy_and_missing_fields(self):
        result = convert([{"word": " Example ", "meaning": "示例"}])[0]
        self.assertEqual(tuple(result), FIELDS)
        self.assertEqual(result["word"], "example")
        for key in ("phonetic", "example", "exampleZh", "level", "source"):
            self.assertEqual(result[key], "")
        self.assertIsNone(result["frequency"])

    def test_deduplicate_and_fill_only_missing(self):
        result = convert([
            {"word": "Example", "meaning": "首条", "frequency": 0},
            {"word": "EXAMPLE", "meaning": "后条", "frequency": 99,
             "phonetic": "/example/", "level": "CET-6", "source": "原始来源"},
        ])
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["meaning"], "首条")
        self.assertEqual(result[0]["frequency"], 0)
        self.assertEqual(result[0]["phonetic"], "/example/")
        self.assertEqual(result[0]["source"], "原始来源")

    def test_aliases_and_supplied_metadata(self):
        item = convert({"data": [{"word": "test", "translations": [
            {"type": "n.", "translation": "测试"}], "freq": "2.5",
            "level": "CET-4", "examples": [{"en": "A test.", "zh": "一次测试。"}]}]},
            default_level="CET-6", default_source="用户指定来源")[0]
        self.assertEqual(item["meaning"], "n. 测试")
        self.assertEqual(item["frequency"], 2.5)
        self.assertEqual(item["level"], "CET-4")
        self.assertEqual(item["source"], "用户指定来源")
        self.assertEqual((item["example"], item["exampleZh"]), ("A test.", "一次测试。"))

    def test_nested_dictionary_does_not_invent_frequency(self):
        result = convert({"headWord": "Test", "wordRank": 12, "content": {"word": {
            "content": {"usphone": "test", "trans": [{"pos": "n", "tranCn": "测试"}],
                        "sentence": {"sentences": [{"sContent": "A test.", "sCn": "测试。"}]}}}}})[0]
        self.assertEqual(result["phonetic"], "test")
        self.assertEqual(result["meaning"], "n 测试")
        self.assertEqual(result["exampleZh"], "测试。")
        self.assertIsNone(result["frequency"])

    def test_invalid_data_fails(self):
        for data in ([{"word": "test"}], [{"word": "test", "meaning": "测试", "frequency": "high"}],
                     [{"word": "test", "meaning": "测试", "frequency": -1}],
                     [{"word": "test", "meaning": "测试", "frequency": True}], {"unknown": []}):
            with self.subTest(data=data), self.assertRaises(ValueError):
                convert(data)

    def test_duplicate_examples_keep_correct_translation(self):
        item = convert([
            {"word": "test", "meaning": "测试", "example": "First sentence."},
            {"word": "TEST", "meaning": "测试", "example": "Other sentence.", "exampleZh": "另一句。"},
        ])[0]
        self.assertEqual(item["example"], "First sentence.")
        self.assertEqual(item["exampleZh"], "")
        item = convert([
            item, {"word": "TEST", "meaning": "测试", "example": "First sentence.", "exampleZh": "第一句。"},
        ])[0]
        self.assertEqual(item["exampleZh"], "第一句。")
        item = convert([{ "word": "test", "meaning": "测试", "exampleZh": "原翻译。",
                         "examples": [{"en": "Other sentence.", "zh": "另一句。"}]}])[0]
        self.assertEqual(item["example"], "")
        self.assertEqual(item["exampleZh"], "原翻译。")

    def test_real_metadata_beats_defaults_after_deduplication(self):
        item = convert([{"word": "test", "meaning": "测试"},
                        {"word": "TEST", "meaning": "测试", "source": "真实来源", "level": 6}],
                       default_source="默认来源", default_level="CET-4")[0]
        self.assertEqual(item["source"], "真实来源")
        self.assertEqual(item["level"], "6")

    def test_extreme_frequency_and_bad_metadata_fail_cleanly(self):
        for fields in ({"frequency": 10**1000}, {"source": {"name": "wrong"}}, {"level": False}):
            with self.subTest(fields=fields), self.assertRaises(ValueError):
                convert([{"word": "test", "meaning": "测试", **fields}])

    def test_5000_words(self):
        source = [{"word": f"word{i}", "meaning": "测试", "frequency": i} for i in range(5000)]
        output = convert(source + [{"word": "WORD0", "meaning": "不会覆盖"}])
        self.assertEqual(len(output), 5000)
        self.assertEqual(output[0]["frequency"], 0)
        self.assertEqual(output[0]["meaning"], "测试")
        json.dumps(output, allow_nan=False)

    def test_failed_output_replacement_keeps_previous_file(self):
        with tempfile.TemporaryDirectory() as folder:
            source, target = Path(folder) / "source.json", Path(folder) / "target.json"
            source.write_text('[{"word":"test","meaning":"test"}]', encoding="utf-8")
            target.write_bytes(b"previous output")
            with patch.object(sys, "argv", ["convert", str(source), str(target)]), \
                    patch("convert_cet_vocab.os.replace", side_effect=OSError("simulated disk error")), \
                    contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                main()
            self.assertEqual(target.read_bytes(), b"previous output")
            self.assertEqual(list(Path(folder).glob(".cet-vocab-*.tmp")), [])

    def test_cli_utf8_bom_and_preserves_input_on_error(self):
        script = Path(__file__).with_name("convert_cet_vocab.py")
        with tempfile.TemporaryDirectory() as folder:
            source, target = Path(folder) / "external.json", Path(folder) / "app.json"
            source.write_text(json.dumps([{"word": "Test", "meaning": "测试"}], ensure_ascii=False), encoding="utf-8-sig")
            result = subprocess.run([sys.executable, "-B", str(script), str(source), str(target),
                                     "--level", "CET-6", "--source", "fixture"], capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            output = json.loads(target.read_text(encoding="utf-8"))
            self.assertEqual(output[0]["level"], "CET-6")
            self.assertEqual(output[0]["source"], "fixture")
            original = target.read_bytes()
            result = subprocess.run([sys.executable, "-B", str(script), str(source), str(source)], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            source.write_text('[{"word":"invalid"}]', encoding="utf-8")
            result = subprocess.run([sys.executable, "-B", str(script), str(source), str(target)], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(target.read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
