---
created_at: 2026-10-11
status: done
---

# 130: 保存状態の破損と未設定を区別する（R13）

## Background

[チェックリストR13](../note/refactoring-checklist.md)。不正Motiveや不正履歴を黙って除外し、空として扱う経路があった。

## Scope

Motiveと探索metadataは配列全体を検証して不正時に明確なエラーを返す。過去Experienceの除外はEvent/Run ID付きで警告する。UIは壊れたsnapshotを空履歴にしない。

## Out of scope

既存DBの自動修復、旧形式への互換変換、履歴削除。

## Implementation notes

実装設計 §5・§18・§29に従う。snapshotが未作成なら空履歴は正常。過去の一部記録破損は警告して除外できるが、現在状態を黙って消して判断させない。

## Acceptance criteria

不正な現在状態がVALIDATIONになり、過去履歴の除外をログから特定できる。UIが不正snapshotを示す。

## Tests

不正MotiveのDB integration、不正snapshotのUI unit、typecheck、対象lint。

## Result

型検査・対象lint成功。Debug UI unit 4件、DB integration 24件成功。旧形式の自動変換なし、migration不要。
