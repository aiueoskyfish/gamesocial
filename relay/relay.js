/* Gun リレー。データの中継のみを行い、DMの内容は復号できません
   （メッセージは送信側の端末で暗号化されています）。 */

const express = require('express');
const Gun = require('gun');

const PORT = process.env.PORT || 8765;

const app = express();

app.get('/', (_req, res) => {
  res.type('text/plain').send('GameSocial Gun relay is running.\nEndpoint: /gun\n');
});

app.get('/health', (_req, res) => res.json({ ok: true, at: Date.now() }));

const server = app.listen(PORT, () => {
  console.log('[relay] listening on ' + PORT + ' (endpoint: /gun)');
});

Gun({
  web: server,
  /* 無料プランのディスク容量は小さいので、保存量を抑える */
  file: process.env.GUN_FILE || 'radata',
  /* リレー同士は繋がなくてよい（繋ぐと無料枠の帯域をすぐ使い切る） */
  peers: []
});
