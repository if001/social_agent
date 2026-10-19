現在のuiはdiscordとterminalですが、音声入出力のuiを作成します。

STTはSenseVoiceなど、TTSはQwen3-TTS(VOICEVOXも検討)を想定し、
クライアントとは異なるサーバー上で動かす想定です。

ざっくりと以下を想定しています。

- VADは音響的な開始・終了だけを担当
Silero VADを常時動かす。VADの無音終了はユーザーターン終了とは扱わない。

- Endpointingには独立したTurn Detectorを利用
LiveKitのローカルTurn Detectorなどを候補にする。VAD単独より自然な会話を目指す。

- Barge-inは暫定停止と確定キャンセルの2段階
相槌やノイズによる誤割り込みを減らしつつ、実際の割り込みには素早く反応する。

- TTSは文単位のストリーミングとする
Qwen3-TTSを評価する。生成・送信・再生を並行化し、音声キューはキャンセル可能にする。

- Echo cancellationはクライアント側で処理
マイクをbot再生中も有効にする。AECを通った入力でVAD・STTを動かす。
