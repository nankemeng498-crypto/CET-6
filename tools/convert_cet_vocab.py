"""把外部四六级 JSON 转为 App 词库；仅使用 Python 标准库。"""
import argparse
import json
import math
import os
from pathlib import Path
import tempfile

FIELDS = ("word", "phonetic", "meaning", "example", "exampleZh", "frequency", "level", "source")


def text(value):
    return value.strip() if isinstance(value, str) else ""


def pick(record, *keys):
    for key in keys:
        value = record.get(key)
        if value is not None and value != "":
            return value
    return None


def frequency(value):
    if value is None or isinstance(value, str) and not value.strip():
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise ValueError("frequency 必须为非负数字或空值")
    try:
        number = float(value)
    except (ValueError, OverflowError) as exc:
        raise ValueError("frequency 必须为非负数字或空值") from exc
    if not math.isfinite(number) or number < 0:
        raise ValueError("frequency 必须为非负数字或空值")
    return int(number) if number.is_integer() else number


def meaning_text(value):
    if isinstance(value, str):
        return value.strip()
    if not isinstance(value, list):
        return ""
    parts = []
    for item in value:
        if isinstance(item, str):
            part = text(item)
        elif isinstance(item, dict):
            translation = text(pick(item, "translation", "tranCn", "meaning", "definition"))
            pos = text(pick(item, "pos", "type"))
            part = f"{pos} {translation}".strip() if translation else ""
        else:
            part = ""
        if part and part not in parts:
            parts.append(part)
    return "；".join(parts)


def metadata_text(value, label, numeric=False):
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if numeric and not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value):
        return str(value)
    raise ValueError(f"{label} 必须为文本或空值")


def records_from(data):
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("words", "data"):
            if isinstance(data.get(key), list):
                return data[key]
        if "word" in data or "headWord" in data:
            return [data]
    raise ValueError("输入须为词条数组、包含 words/data 数组的对象或单个词条")


def convert_record(record, default_level="", default_source=""):
    if not isinstance(record, dict):
        raise ValueError("词条须为 JSON 对象")
    # 兼容常见有道词库的 content.word.content；不把 wordRank 当词频。
    content = record.get("content", {})
    nested_word = content.get("word", {}) if isinstance(content, dict) else {}
    nested_word = nested_word if isinstance(nested_word, dict) else {}
    details = nested_word.get("content", {})
    details = details if isinstance(details, dict) else {}
    word = text(pick(record, "word", "headWord")) or text(nested_word.get("wordHead"))
    meaning = meaning_text(pick(record, "meaning", "translation", "translations", "trans")) or meaning_text(details.get("trans"))
    if not word or not meaning:
        raise ValueError("词条缺少英文 word 或中文 meaning/translation/translations")
    phonetic = text(pick(record, "phonetic", "usphone", "ukphone")) or text(pick(details, "usphone", "ukphone"))
    example = text(record.get("example"))
    example_zh = text(record.get("exampleZh"))
    examples = record.get("examples")
    sentence = details.get("sentence", {})
    if not isinstance(examples, list):
        examples = sentence.get("sentences", []) if isinstance(sentence, dict) else []
    if not isinstance(examples, list):
        examples = []
    # 只选源数据中的第一条完整英文例句及其配对翻译。
    if not example:
        for item in examples:
            if isinstance(item, str) and text(item) and not example_zh:
                example = text(item)
                break
            if isinstance(item, dict):
                candidate = text(pick(item, "example", "en", "sContent"))
                candidate_zh = text(pick(item, "exampleZh", "zh", "sCn"))
                if candidate and (not example_zh or candidate_zh == example_zh):
                    example = candidate
                    if not example_zh:
                        example_zh = candidate_zh
                    break
    level = pick(record, "level")
    source = pick(record, "source")
    return dict(zip(FIELDS, (
        word.lower(), phonetic, meaning, example, example_zh,
        frequency(pick(record, "frequency", "freq")),
        metadata_text(level, "level", numeric=True) or default_level,
        metadata_text(source, "source") or default_source,
    )))


def convert(data, default_level="", default_source=""):
    words = {}
    for index, record in enumerate(records_from(data), 1):
        try:
            item = convert_record(record)
        except ValueError as exc:
            raise ValueError(f"第 {index} 条：{exc}") from exc
        key = item["word"]
        if key not in words:
            words[key] = item
        else:
            # 重复词保留首条已有内容，只补空字段；0 是有效词频。
            for field in ("phonetic", "meaning", "frequency", "level", "source"):
                if words[key][field] is None or words[key][field] == "":
                    words[key][field] = item[field]
            existing = words[key]
            if not existing["example"] and (not existing["exampleZh"] or existing["exampleZh"] == item["exampleZh"]):
                existing["example"] = item["example"]
                if not existing["exampleZh"]:
                    existing["exampleZh"] = item["exampleZh"]
            elif existing["example"] == item["example"] and not existing["exampleZh"]:
                existing["exampleZh"] = item["exampleZh"]
    for item in words.values():
        item["level"] = item["level"] or default_level
        item["source"] = item["source"] or default_source
    return list(words.values())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="外部 JSON 文件（UTF-8，可带 BOM）")
    parser.add_argument("output", type=Path, help="App 词库 JSON 文件")
    parser.add_argument("--level", default="", help="缺失 level 时使用，例如 CET-6")
    parser.add_argument("--source", default="", help="缺失 source 时使用，例如词库名称")
    args = parser.parse_args()
    if args.input.resolve() == args.output.resolve():
        parser.error("输入和输出不能是同一个文件")
    temporary = None
    try:
        data = json.loads(args.input.read_text(encoding="utf-8-sig"))
        output = convert(data, args.level.strip(), args.source.strip())
        payload = json.dumps(output, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
        # 同目录临时文件写完再替换，写入失败时保留已有输出。
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=args.output.parent,
                                         prefix=".cet-vocab-", suffix=".tmp", delete=False) as file:
            temporary = Path(file.name)
            file.write(payload)
        os.replace(temporary, args.output)
        temporary = None
    except (OSError, ValueError) as exc:
        parser.exit(1, f"转换失败：{exc}\n")
    finally:
        if temporary is not None:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass
    print(f"转换完成：{len(output)} 个去重单词 → {args.output}")


if __name__ == "__main__":
    main()
