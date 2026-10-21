// 画面の通しの確認（ヘッドレス Chromium）。
// 使い方：npm run build のあと npx vite preview --port 4173 を起動しておき、
//   node scripts/browser-check.cjs [スクリーンショットを置くフォルダ]
// 確認用の録画は ffmpeg で作る（このリポジトリには入れない）。
// ファイルを選ぶ画面は、ブラウザの中の保存場所（OPFS）のファイルを返すように差し替える。
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
const APP = process.env.APP_URL || 'http://localhost:4173/';
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'teroppa-check'));
const FIX = path.join(OUT, 'fixtures');
fs.mkdirSync(FIX, { recursive: true });

function makeFixtures() {
  // 字幕ファイル（e.mkv の「間」を切ったあとの時刻）
  fs.writeFileSync(
    path.join(FIX, 'subs.srt'),
    [
      '1\n00:00:00,100 --> 00:00:02,200\nこんにちは、今日はボス戦です\n',
      '2\n00:00:02,900 --> 00:00:05,000\nこのボスは実は弱点があって背中を狙うと大ダメージです\n',
      '3\n00:00:06,000 --> 00:00:08,000\nいきます\n',
    ].join('\n'),
  );
  const ff = (args, name) => {
    const file = path.join(FIX, name);
    if (!fs.existsSync(file)) execSync(`ffmpeg -hide_banner -loglevel error -y ${args} ${file}`);
  };
  // 1秒あたり60コマ・音1つ
  ff('-f lavfi -i testsrc2=size=1280x720:rate=60 -f lavfi -i sine=frequency=660:sample_rate=48000 -t 8 -c:v libvpx-vp9 -b:v 1M -deadline realtime -cpu-used 8 -c:a libopus', 'a.webm');
  // OBS のように音が2つ入った MKV
  ff('-f lavfi -i testsrc2=size=1920x1080:rate=30 -f lavfi -i sine=frequency=440:sample_rate=48000 -f lavfi -i sine=frequency=220:sample_rate=48000 -t 6 -map 0 -map 1 -map 2 -c:v libvpx-vp9 -b:v 1M -deadline realtime -cpu-used 8 -c:a libopus', 'b.mkv');
  // 音なし・縦長・44.1kHz モノラル
  ff('-f lavfi -i testsrc2=size=640x480:rate=25 -t 3 -c:v libvpx-vp9 -b:v 300k -deadline realtime -cpu-used 8', 'c.webm');
  // OBS のように 音1＝全部、音2＝声（2.5秒しゃべって1.5秒休む）、音3＝ゲームの音
  ff('-f lavfi -i testsrc2=size=1280x720:rate=30 -f lavfi -i "aevalsrc=0.4*sin(2*PI*220*t)*lt(mod(t\\,4)\\,2.5)+0.1*sin(2*PI*1000*t):s=48000" -f lavfi -i "aevalsrc=0.4*sin(2*PI*220*t)*lt(mod(t\\,4)\\,2.5):s=48000" -f lavfi -i "aevalsrc=0.1*sin(2*PI*1000*t):s=48000" -t 20 -map 0 -map 1 -map 2 -map 3 -c:v libvpx-vp9 -b:v 600k -deadline realtime -cpu-used 8 -c:a libopus', 'e.mkv');
  ff('-f lavfi -i testsrc2=size=1080x1920:rate=30 -f lavfi -i sine=frequency=500:sample_rate=44100 -t 3 -ac 1 -c:v libvpx-vp9 -b:v 500k -deadline realtime -cpu-used 8 -c:a libvorbis', 'd.webm');
  // v0.5：真っ黒な録画（画像やフェードを見分けやすい）・赤い画像・自分で用意した曲の代わり
  ff('-f lavfi -i color=c=black:size=1280x720:rate=30 -f lavfi -i "aevalsrc=0.4*sin(2*PI*220*t)*lt(mod(t\\,4)\\,2):s=48000" -t 8 -c:v libvpx-vp9 -b:v 300k -deadline realtime -cpu-used 8 -c:a libopus', 'f.webm');
  ff('-f lavfi -i color=c=red:size=400x200 -frames:v 1', 'red.png');
  ff('-f lavfi -i sine=frequency=880:sample_rate=44100 -t 3', 'tone.wav');
  // v0.7：しゃべりの代わり（高さが揺れる音）と、「えー」の代わり（同じ高さでのばした音）に、雑音（ざー・ぶーん）を足した録画
  const talk = '0.25*sin(2*PI*150*t+6*sin(2*PI*3*t))*(0.6+0.4*sin(2*PI*5*t))';
  const er = '0.2*(sin(2*PI*150*t)+0.5*sin(2*PI*300*t))';
  const on = (a, b) => `between(t\\,${a}\\,${b})`;
  const voice = `${talk}*(${on(0.3, 2.5)}+${on(4.6, 7)}+${on(8.6, 11)})+${er}*${on(3.2, 3.9)}`;
  const hiss = '0.02*(random(1)*2-1)+0.015*sin(2*PI*60*t)';
  ff(`-f lavfi -i color=c=gray:size=640x360:rate=30 -f lavfi -i "aevalsrc=${voice}+${hiss}:s=48000" -t 12 -c:v libvpx-vp9 -b:v 200k -deadline realtime -cpu-used 8 -c:a libopus -b:a 128k`, 'g.webm');
  fs.writeFileSync(path.join(FIX, 'g.srt'), '1\n00:00:03,200 --> 00:00:03,900\nえー\n\n2\n00:00:04,600 --> 00:00:07,000\nボスの弱点は背中です\n');
}

// ファイルを選ぶ画面・保存する場所を選ぶ画面の代わり
const stubPickers = () => {
  window.__pickQueue = [];
  window.__saveNames = [];
  // 「AIに聞く」で開くサイトとコピーした文字を記録する（本当には開かない）
  window.__opened = [];
  window.__copied = [];
  window.open = (url) => {
    window.__opened.push(String(url));
    return null;
  };
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => void window.__copied.push(t) }, configurable: true });
  window.showOpenFilePicker = async () => {
    const names = window.__pickQueue.shift();
    if (!names) throw new DOMException('閉じた', 'AbortError');
    const root = await navigator.storage.getDirectory();
    return Promise.all(names.map((n) => root.getFileHandle(n)));
  };
  window.showSaveFilePicker = async (opts) => {
    const root = await navigator.storage.getDirectory();
    return root.getFileHandle(window.__saveNames.shift() || `saved-${opts?.suggestedName}`, { create: true });
  };
};

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'OK ' : 'NG '} ${label}${detail ? `（${detail}）` : ''}`);
  if (!ok) failures++;
}

async function putFixture(page, name) {
  await page.evaluate(
    async ({ name, url }) => {
      const root = await navigator.storage.getDirectory();
      const w = await (await root.getFileHandle(name, { create: true })).createWritable();
      await (await fetch(url)).body.pipeTo(w);
    },
    { name, url: `${APP}__fixtures/${name}` },
  );
}

async function readOpfs(page, name) {
  const b64 = await page.evaluate(async (name) => {
    const root = await navigator.storage.getDirectory();
    const buf = new Uint8Array(await (await (await root.getFileHandle(name)).getFile()).arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  }, name);
  return Buffer.from(b64, 'base64');
}

function probe(file) {
  return JSON.parse(execSync(`ffprobe -v error -show_entries stream=codec_type,codec_name,width,height,r_frame_rate:format=duration -of json ${file}`).toString());
}

/** 上の手順の案内から、手順を選ぶ */
const goStep = (page, label) => page.locator('nav.steps button', { hasText: label }).click();

async function exportTo(page, name) {
  await goStep(page, '書き出し');
  await page.getByRole('radio', { name: /軽い/ }).click();
  await page.evaluate((n) => window.__saveNames.push(n), name);
  await page.getByRole('button', { name: '書き出す' }).click();
  await page.waitForSelector('text=書き出しが終わりました', { timeout: 180000 });
  const file = path.join(OUT, name);
  fs.writeFileSync(file, await readOpfs(page, name));
  return probe(file);
}

const timeText = (page) => page.locator('.controls .time').innerText();

async function main() {
  makeFixtures();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const context = await browser.newContext({ viewport: { width: 1366, height: 820 }, colorScheme: 'dark' });
  await context.route('**/__fixtures/*', (route) => route.fulfill({ path: path.join(FIX, path.basename(new URL(route.request().url()).pathname)) }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // 作業環境によっては AI の部品の配布元（huggingface.co）につながらない。そのときのエラーは数えない
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('ERR_TUNNEL_CONNECTION_FAILED') && errors.push(m.text()));
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(stubPickers);
  await page.goto(APP);
  await page.waitForSelector('.guide h2');
  await page.screenshot({ path: path.join(OUT, '01-empty.png') });

  for (const n of ['a.webm', 'b.mkv', 'c.webm', 'd.webm', 'e.mkv', 'subs.srt', 'f.webm', 'red.png', 'tone.wav', 'g.webm', 'g.srt']) await putFixture(page, n);

  // 読み込み
  await page.evaluate(() => window.__pickQueue.push(['a.webm', 'b.mkv']));
  await page.getByRole('button', { name: '録画を選ぶ' }).click();
  await page.waitForSelector('.toast');
  // b.mkv は音が2つ入っているので、音の設定が開く（そのまま決める）
  await page.getByRole('dialog', { name: '音の設定' }).getByRole('button', { name: '決める' }).click();
  check('録画を2本読み込める', (await page.locator('.source-list li').count()) === 2);
  check('長さが合う', (await timeText(page)).endsWith('0:14.0'), await timeText(page));
  await page.screenshot({ path: path.join(OUT, '02-imported.png') });

  // 再生
  await page.keyboard.press('Space');
  await page.waitForTimeout(1200);
  await page.keyboard.press('Space');
  check('再生すると再生位置が進む', !(await timeText(page)).startsWith('0:00.0'), await timeText(page));

  // なぞって消す
  const box = await page.locator('.timeline-wrap canvas').boundingBox();
  const xAt = (t, total) => box.x + (t / total) * box.width;
  const yTrack = box.y + 26 + 22 + 40;
  await page.mouse.move(xAt(2, 14.017), yTrack);
  await page.mouse.down();
  await page.mouse.move(xAt(4, 14.017), yTrack, { steps: 8 });
  await page.mouse.up();
  await page.waitForSelector('.selection-actions');
  await page.screenshot({ path: path.join(OUT, '03-selection.png') });
  await page.keyboard.press('Delete');
  check('なぞった範囲を消せる', (await timeText(page)).endsWith('0:12.0'), await timeText(page));

  // 並べ替え（最後のかたまりを先頭へ）
  const yHeader = box.y + 26 + 11;
  await page.mouse.move(xAt(10, 12), yHeader);
  await page.mouse.down();
  await page.mouse.move(xAt(0.3, 12), yHeader, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, '04-reordered.png') });

  // 元に戻す・やり直す
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  check('元に戻せる', (await timeText(page)).endsWith('0:14.0'), await timeText(page));
  await page.keyboard.press('Control+y');
  check('やり直せる', (await timeText(page)).endsWith('0:12.0'), await timeText(page));

  // 作品ファイル
  await page.evaluate(() => window.__saveNames.push('test.teroppa'));
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(400);
  const saved = JSON.parse((await readOpfs(page, 'test.teroppa')).toString('utf8'));
  check('作品ファイルに保存できる', saved.format === 'teroppa-project' && saved.project.clips.length === 3);

  // 書き出し
  const out = await exportTo(page, 'out.mp4');
  const dur = Number(out.format.duration);
  check('書き出した動画の長さが合う', Math.abs(dur - 12.02) < 0.1, `${dur}秒`);
  check('書き出した動画に映像と音がある', out.streams.some((s) => s.codec_type === 'video') && out.streams.some((s) => s.codec_type === 'audio'));
  await page.screenshot({ path: path.join(OUT, '05-exported.png') });

  // 開き直すと続きから
  await page.reload();
  await page.waitForTimeout(1500);
  check('開き直すと続きから作業できる', (await timeText(page)).endsWith('0:12.0') && (await page.locator('.source-list li.missing').count()) === 0);

  // 作品ファイルを開いて、録画を選び直す
  await page.evaluate(() => window.__pickQueue.push(['test.teroppa']));
  await page.getByRole('button', { name: '開く' }).click();
  await page.waitForSelector('text=録画を開き直してください');
  await page.screenshot({ path: path.join(OUT, '06-missing.png') });
  await page.evaluate(() => window.__pickQueue.push(['a.webm', 'b.mkv']));
  await page.getByRole('button', { name: '録画を選び直す' }).click();
  await page.waitForSelector('text=いらない部分を消しましょう');
  check('作品ファイルを開いて録画を選び直せる', true);

  // 形式の違う録画をまとめて書き出す（音なし・縦長・44.1kHz モノラル）
  await page.getByRole('button', { name: '新しく' }).click();
  await page.evaluate(() => window.__pickQueue.push(['c.webm', 'd.webm', 'a.webm']));
  await page.getByRole('button', { name: '録画を選ぶ' }).click();
  await page.waitForSelector('.toast');
  const mixed = await exportTo(page, 'mixed.mp4');
  check('形式の違う録画もまとめて書き出せる', Math.abs(Number(mixed.format.duration) - 14) < 0.1, `${mixed.format.duration}秒`);

  // 声を選ぶ（v0.2）
  await page.getByRole('button', { name: /編集に戻る/ }).click();
  await page.getByRole('button', { name: '新しく' }).click();
  await page.evaluate(() => window.__pickQueue.push(['e.mkv']));
  await page.getByRole('button', { name: '録画を選ぶ' }).click();
  const dialog = page.getByRole('dialog', { name: '音の設定' });
  await dialog.waitFor();
  check('音が複数ある録画では、音の設定が開く', true);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, '09-audio-dialog.png') });
  await dialog.getByRole('button', { name: '聴く' }).nth(1).click();
  await page.waitForTimeout(500);
  await dialog.getByRole('radiogroup', { name: '音1の役割' }).getByRole('radio', { name: '使わない' }).click();
  await dialog.getByRole('radiogroup', { name: '音2の役割' }).getByRole('radio', { name: 'あなたの声' }).click();
  await dialog.getByRole('radiogroup', { name: '音3の役割' }).getByRole('radio', { name: 'ゲームの音など' }).click();
  await dialog.getByRole('button', { name: '決める' }).click();

  // 「間」を切る（v0.2）：声は 2.5秒しゃべって1.5秒休むので、1.5秒の「間」が5か所ある
  await page.getByRole('button', { name: /次へ：「間」を切る/ }).click();
  await page.waitForSelector('text=か所見つけました', { timeout: 60000 });
  const found = await page.locator('.guide p').first().innerText();
  check('「間」を5か所見つける', found.includes('5か所'), found);
  await page.screenshot({ path: path.join(OUT, '10-silence.png') });
  // 最初の候補（3秒あたり）を押して残す
  const box2 = await page.locator('.timeline-wrap canvas').boundingBox();
  await page.mouse.click(box2.x + (3.25 / 20) * box2.width, box2.y + 26 + 22 + 40);
  check('候補を押すと、その場所を残せる', (await page.locator('.guide p').first().innerText()).includes('1か所を残します'));
  await page.getByRole('button', { name: 'まとめて切る' }).click();
  await page.waitForSelector('text=「間」を切りました');
  const afterCut = await timeText(page);
  const seconds = (t) => t.split(':').reduce((a, b) => a * 60 + Number(b), 0);
  const cutLength = seconds(afterCut.split(' / ')[1]);
  // 1.5秒の「間」のうち4か所を切る（1か所は残すと決めた）。音の切り替わりの前後に音のにじみがあるので、3〜6秒くらい短くなる
  check('まとめて切ると短くなる', cutLength > 14 && cutLength < 17, afterCut);
  await page.screenshot({ path: path.join(OUT, '11-silence-cut.png') });
  await page.keyboard.press('Control+z');
  check('切ったあとも元に戻せる', (await timeText(page)).endsWith('0:20.0'), await timeText(page));
  await page.keyboard.press('Control+y');
  const cutOut = await exportTo(page, 'cut.mp4');
  check('切ったあとの動画を書き出せる', Math.abs(Number(cutOut.format.duration) - cutLength) < 0.1, `${cutOut.format.duration}秒`);

  // 字幕（v0.3）：AI の部品をダウンロードできない環境では、了承のあとに分かりやすく失敗する
  await page.getByRole('button', { name: /編集に戻る/ }).click();
  await goStep(page, '字幕');
  await page.getByRole('button', { name: '自動で字幕を作る' }).click();
  await page.waitForSelector('text=AI の部品をダウンロードします');
  check('AI の部品をダウンロードする前に了承をとる', (await page.locator('.guide').innerText()).includes('IP アドレス'));
  await page.screenshot({ path: path.join(OUT, '12-consent.png') });
  await page.getByRole('button', { name: 'ダウンロードして始める' }).click();
  const failed = await page.waitForSelector('.note.warn', { timeout: 60000 }).then(() => true, () => false);
  check('ダウンロードできないときは、理由を出す', failed, failed ? (await page.locator('.note.warn').innerText()).replace(/\n/g, ' ') : '');
  // 字幕ファイルを読み込んで、直す
  await page.evaluate(() => window.__pickQueue.push(['subs.srt']));
  await page.getByRole('button', { name: /字幕ファイル（.srt）を読み込む/ }).click();
  await page.waitForSelector('.sub-row');
  check('字幕ファイルを読み込める', (await page.locator('.sub-row').count()) === 3);
  const second = page.locator('.sub-row').nth(1);
  check('長い字幕は2行に分かれる', (await second.locator('.sub-text span').count()) === 2, await second.locator('.sub-text').innerText());
  await page.locator('.sub-row').nth(2).locator('.sub-text').click();
  await page.locator('.sub-row textarea').fill('いくぞ！');
  await page.locator('.sub-row textarea').press('Control+Enter');
  check('字幕を書き換えられる', (await page.locator('.sub-row').nth(2).innerText()).includes('いくぞ！'));
  await page.locator('.sub-row').nth(0).getByRole('button', { name: '後ろの字幕とつなぐ' }).click();
  check('字幕をつなげる', (await page.locator('.sub-row').count()) === 2);
  await page.keyboard.press('Control+z');
  check('つないだのを元に戻せる', (await page.locator('.sub-row').count()) === 3);
  await page.getByRole('radio', { name: '黄', exact: true }).click();
  await page.getByRole('radiogroup', { name: '字幕の大きさ' }).getByRole('radio', { name: '大' }).click();
  await page.locator('.sub-row').nth(1).locator('.sub-time').click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, '13-subtitles.png') });
  // 文章で編集（v0.4）：2行目（2.9〜5.0秒。かたまりの境目をまたがない）の部分を動画から消す
  const beforeCut = await timeText(page);
  await page.locator('.sub-row').nth(1).getByRole('button', { name: 'この部分を動画から消す' }).click();
  await page.waitForSelector('.sub-confirm');
  check('消す前に、どこが消えるかを確かめる', (await page.locator('.sub-confirm').innerText()).includes('動画から消しますか'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '13b-text-cut.png') });
  await page.locator('.sub-confirm').getByRole('button', { name: '消す' }).click();
  const afterTextCut = await timeText(page);
  const sec = (t) => t.split(' / ')[1].split(':').reduce((a, b) => a * 60 + Number(b), 0);
  check('字幕の行を消すと、その部分の動画も消える', (await page.locator('.sub-row').count()) === 2 && Math.abs(sec(beforeCut) - sec(afterTextCut) - 2.1) < 0.15, `${beforeCut} → ${afterTextCut}`);
  await page.keyboard.press('Control+z');
  check('文章で消したのも元に戻せる', (await page.locator('.sub-row').count()) === 3 && (await timeText(page)).endsWith(beforeCut.split(' / ')[1]));

  // 字幕ファイルを書き出す
  await page.evaluate(() => window.__saveNames.push('out.srt'));
  await page.getByRole('button', { name: /字幕ファイル（.srt）を書き出す/ }).click();
  await page.waitForTimeout(400);
  const srtOut = (await readOpfs(page, 'out.srt')).toString('utf8');
  check('字幕ファイルを書き出せる', srtOut.includes('いくぞ！') && srtOut.includes('-->'), srtOut.split('\n').slice(0, 3).join(' | '));
  // 字幕の入った動画を書き出す
  const subOut = await exportTo(page, 'subs.mp4');
  check('字幕の入った動画を書き出せる', Number(subOut.format.duration) > 10);
  execSync(`ffmpeg -v error -y -ss 4 -i ${path.join(OUT, 'subs.mp4')} -frames:v 1 ${path.join(OUT, '14-burned-subtitle.png')}`);

  // 飾り・BGM・効果音（v0.5）：真っ黒な録画と、模様の録画をつなぐ
  await page.getByRole('button', { name: /編集に戻る/ }).click();
  await page.getByRole('button', { name: '新しく' }).click();
  await page.evaluate(() => window.__pickQueue.push(['f.webm', 'a.webm']));
  await page.getByRole('button', { name: '録画を選ぶ' }).click();
  await page.waitForSelector('.toast');
  await goStep(page, '飾り');
  await page.waitForSelector('text=画像や演出を入れましょう');
  // 1〜3秒をなぞって、画像を置く
  const box3 = await page.locator('.timeline-wrap canvas').boundingBox();
  const x3 = (t) => box3.x + (t / 16) * box3.width;
  await page.mouse.move(x3(1), box3.y + 26 + 22 + 40);
  await page.mouse.down();
  await page.mouse.move(x3(3), box3.y + 26 + 22 + 40, { steps: 6 });
  await page.mouse.up();
  await page.evaluate(() => window.__pickQueue.push(['red.png']));
  await page.locator('.selection-actions').getByRole('button', { name: 'ここに画像を置く' }).click();
  await page.waitForSelector('.item-list li');
  check('なぞった範囲に画像を置ける', (await page.locator('.decorate-panel .item-list li').count()) === 1);
  await page.waitForSelector('.box-handles');
  check('置いた画像を、プレビューの上で動かせる枠が出る', true);
  const red = async () =>
    page.evaluate(() => {
      const c = document.querySelector('.preview-box canvas');
      const g = c.getContext('2d');
      const d = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data.slice(0, 3));
      return { topRight: d(1100, 100), center: d(640, 360) };
    });
  await page.waitForTimeout(500);
  let px = await red();
  check('画像は右上に出る', px.topRight[0] > 200 && px.topRight[1] < 60 && px.center[0] < 40, JSON.stringify(px));
  await page.getByRole('radiogroup', { name: '画像の置き方' }).getByRole('radio', { name: '中央' }).click();
  await page.waitForTimeout(400);
  px = await red();
  check('置き方を「中央」に変えられる', px.center[0] > 200 && px.topRight[0] < 40, JSON.stringify(px));
  // 枠をドラッグして左へ動かす
  const hb = await page.locator('.box-handles').boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 - 150, hb.y + hb.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const hb2 = await page.locator('.box-handles').boundingBox();
  check('画像をドラッグで動かせる', hb2.x < hb.x - 100, `${Math.round(hb.x)} → ${Math.round(hb2.x)}`);
  await page.getByRole('radiogroup', { name: '画像の置き方' }).getByRole('radio', { name: '右上' }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '15-decorate.png') });
  // つなぎ目（8秒）にフェード
  await page.locator('.timeline-wrap canvas').click({ position: { x: (7.8 / 16) * box3.width, y: 26 + 22 + 40 } });
  await page.getByRole('tab', { name: 'フェード' }).click();
  await page.getByRole('checkbox', { name: /0:08 のつなぎ目をフェードにする/ }).check();
  check('つなぎ目にフェードを入れられる', await page.getByRole('checkbox', { name: /0:08 のつなぎ目/ }).isChecked());
  // BGM と効果音
  await page.getByRole('button', { name: /次へ：音の仕上げ/ }).click();
  await page.waitForSelector('text=音を仕上げましょう');
  await page.getByRole('tab', { name: 'BGM' }).click();
  await page.getByRole('radio', { name: /おだやか/ }).click();
  await page.screenshot({ path: path.join(OUT, '16a-bgm.png') });
  await page.getByRole('button', { name: 'おだやかを試しに聴く' }).click();
  await page.waitForSelector('button[aria-label="おだやかを止める"]', { timeout: 10000 });
  check('入っている曲を試しに聴ける', true);
  await page.getByRole('button', { name: 'おだやかを止める' }).click();
  await page.locator('.timeline-wrap canvas').click({ position: { x: (5 / 16) * box3.width, y: 26 + 22 + 40 } });
  await page.getByRole('tab', { name: '効果音' }).click();
  await page.locator('.sound-cell').first().getByRole('button', { name: 'ピコン', exact: true }).click();
  check('効果音を再生位置に置ける', (await page.locator('.sound-panel .item-list li').count()) === 1);
  await page.screenshot({ path: path.join(OUT, '16-sound.png') });
  const deco = await exportTo(page, 'deco.mp4');
  const decoFile = path.join(OUT, 'deco.mp4');
  check('飾りと BGM の入った動画を書き出せる', Math.abs(Number(deco.format.duration) - 16) < 0.1, `${deco.format.duration}秒`);
  // 書き出した動画を調べる：2秒の右上は赤、8秒（つなぎ目）は真っ黒、BGM は声がない間（2.5秒あたり）も鳴っている
  const frameAt = (t) => {
    const raw = execSync(`ffmpeg -v error -ss ${t} -i ${decoFile} -frames:v 1 -vf scale=64:36 -f rawvideo -pix_fmt rgb24 -`);
    return (x, y) => Array.from(raw.subarray((y * 64 + x) * 3, (y * 64 + x) * 3 + 3));
  };
  const f2 = frameAt(2);
  check('書き出した動画に画像が入っている', f2(55, 5)[0] > 180 && f2(55, 5)[1] < 80, JSON.stringify(f2(55, 5)));
  const f6 = frameAt(6);
  check('画像は、置いた時間のあとは消える', f6(55, 5)[0] < 40, JSON.stringify(f6(55, 5)));
  // つなぎ目（8秒）の直後は暗く、少しあとは模様が見える
  const brightness = (f) => {
    let sum = 0;
    for (let y = 0; y < 36; y += 3) for (let x = 0; x < 64; x += 3) sum += f(x, y).reduce((a, b) => a + b, 0) / 3;
    return sum / (12 * 22);
  };
  const dark = brightness(frameAt(8.05));
  const bright = brightness(frameAt(9));
  check('つなぎ目のフェードで画面が暗くなる', dark < bright * 0.3, `${Math.round(dark)} / ${Math.round(bright)}`);
  execSync(`ffmpeg -v error -y -ss 8.2 -i ${decoFile} -frames:v 1 ${path.join(OUT, '18-fade.png')}`);
  execSync(`ffmpeg -v error -y -ss 2 -i ${decoFile} -frames:v 1 ${path.join(OUT, '17-exported-image.png')}`);
  const rms = (from, len) => {
    const out = execSync(`ffmpeg -v info -ss ${from} -t ${len} -i ${decoFile} -af astats=metadata=0 -f null - 2>&1`).toString();
    const m = /RMS level dB: (-?[\d.]+|-inf)/.exec(out.split('Overall')[1] ?? '');
    return m ? Number(m[1] === '-inf' ? -200 : m[1]) : NaN;
  };
  const quiet = rms(2.6, 1);
  check('しゃべっていない間も BGM が鳴っている', quiet > -45, `${quiet}dB`);
  const fadeQuiet = rms(7.95, 0.1);
  check('つなぎ目のフェードで音も小さくなる', fadeQuiet < quiet + 6, `${fadeQuiet}dB`);
  // 自分で用意した曲（著作権の確認をしてから選ぶ）
  await page.getByRole('button', { name: /編集に戻る/ }).click();
  await goStep(page, '音の仕上げ');
  await page.getByRole('tab', { name: 'BGM' }).click();
  await page.getByRole('button', { name: '自分で用意した曲を使う' }).click();
  check('自分で用意した曲を選ぶ前に、著作権の注意を出す', (await page.locator('.note.rights').innerText()).includes('著作権'));
  await page.evaluate(() => window.__pickQueue.push(['tone.wav']));
  await page.getByRole('button', { name: '確かめたので、曲を選ぶ' }).click();
  await page.waitForSelector('text=tone.wav', { timeout: 10000 });
  check('自分で用意した曲を BGM にできる', await page.getByRole('radio', { name: /tone\.wav/ }).getAttribute('aria-checked') === 'true');
  const own = await exportTo(page, 'own-bgm.mp4');
  check('自分で用意した曲の入った動画を書き出せる', Math.abs(Number(own.format.duration) - 16) < 0.1, `${own.format.duration}秒`);
  // 作品ファイルに画像と曲も入る
  await page.evaluate(() => window.__saveNames.push('deco.teroppa'));
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(600);
  const decoSaved = JSON.parse((await readOpfs(page, 'deco.teroppa')).toString('utf8'));
  check(
    '作品ファイルに画像と曲も入る',
    decoSaved.project.images.length === 1 && Object.keys(decoSaved.assetData).length === 2 && decoSaved.project.effects.length === 1,
    `画像${decoSaved.project.images.length}・中身${Object.keys(decoSaved.assetData).length}`,
  );

  // 速さ・矢印や枠・拡大（v0.6）：真っ黒な録画（8秒）のあとに、模様と 660Hz の音の録画（8秒）
  await page.getByRole('button', { name: /編集に戻る/ }).click();
  await page.getByRole('button', { name: '新しく' }).click();
  await page.evaluate(() => window.__pickQueue.push(['f.webm', 'a.webm']));
  await page.getByRole('button', { name: '録画を選ぶ' }).click();
  await page.waitForSelector('.toast');
  await goStep(page, '飾り');
  const box4 = await page.locator('.timeline-wrap canvas').boundingBox();
  const drag4 = async (a, b, total) => {
    const x = (t) => box4.x + (t / total) * box4.width;
    await page.mouse.move(x(a), box4.y + 26 + 22 + 40);
    await page.mouse.down();
    await page.mouse.move(x(b), box4.y + 26 + 22 + 40, { steps: 6 });
    await page.mouse.up();
  };
  // 8〜12秒（模様の録画の最初の4秒）を2倍にする
  await page.getByRole('tab', { name: '速さ' }).click();
  await drag4(8, 12, 16.017);
  await page.getByRole('group', { name: '速さ' }).getByRole('button', { name: '2倍' }).click();
  check('なぞった範囲を2倍の速さにすると短くなる', (await timeText(page)).endsWith('0:14.0'), await timeText(page));
  // 1秒の位置に丸と矢印を置く
  await page.getByRole('tab', { name: '矢印・枠' }).click();
  await page.locator('.timeline-wrap canvas').click({ position: { x: (1 / 14) * box4.width, y: 26 + 22 + 40 } });
  await page.getByRole('button', { name: '丸を置く' }).click();
  await page.waitForTimeout(400);
  const redOnRow = () =>
    page.evaluate(() => {
      const g = document.querySelector('.preview-box canvas').getContext('2d');
      const row = g.getImageData(0, 360, 1280, 1).data;
      let n = 0;
      for (let i = 0; i < row.length; i += 4) if (row[i] > 200 && row[i + 1] < 120 && row[i + 2] < 120) n++;
      return n;
    });
  check('丸を置くと、プレビューに赤い丸が出る', (await redOnRow()) > 4, `${await redOnRow()}ピクセル`);
  await page.getByRole('radiogroup', { name: '図形の色' }).getByRole('radio', { name: '黄', exact: true }).click();
  await page.waitForTimeout(300);
  check('丸の色を変えられる', (await redOnRow()) === 0);
  await page.getByRole('button', { name: '矢印を置く' }).click();
  await page.getByRole('radiogroup', { name: '矢印の向き' }).getByRole('radio', { name: '右上へ' }).click();
  await page.getByRole('group', { name: '図形の置き場所' }).getByRole('button', { name: '左下' }).click();
  check('矢印を置いて、向きと場所を変えられる', (await page.locator('.decorate-panel .item-list li').count()) === 2);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '19-shapes.png') });
  // 12.5秒あたり（模様の録画、元の速さの部分）の真ん中を2倍に拡大する
  await page.getByRole('tab', { name: '拡大' }).click();
  await drag4(11, 13.5, 14);
  await page.locator('.selection-actions').getByRole('button', { name: 'ここを拡大する' }).click();
  await page.waitForSelector('.box-handles.dashed');
  check('拡大を入れると、拡大する場所を選ぶ点線の四角が出る', true);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '20-zoom-edit.png') });
  await page.getByRole('button', { name: '選ぶのをやめる' }).click();
  await page.locator('.timeline-wrap canvas').click({ position: { x: (12.5 / 14) * box4.width, y: 26 + 22 + 40 } });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, '21-zoomed.png') });
  const v6 = await exportTo(page, 'v06.mp4');
  const v6File = path.join(OUT, 'v06.mp4');
  check('速さ・図形・拡大の入った動画を書き出せる', Math.abs(Number(v6.format.duration) - 14) < 0.1, `${v6.format.duration}秒`);
  const frame6 = (t) => {
    const raw = execSync(`ffmpeg -v error -ss ${t} -i ${v6File} -frames:v 1 -vf scale=64:36 -f rawvideo -pix_fmt rgb24 -`);
    return (x, y) => Array.from(raw.subarray((y * 64 + x) * 3, (y * 64 + x) * 3 + 3));
  };
  // 線は細いので、大きめの絵で数える
  const raw2 = execSync(`ffmpeg -v error -ss 2 -i ${v6File} -frames:v 1 -vf scale=320:180 -f rawvideo -pix_fmt rgb24 -`);
  let colored = 0;
  for (let i = 0; i < raw2.length; i += 3) if (raw2[i] > 150 || raw2[i + 1] > 150) colored++;
  check('書き出した動画に矢印・丸が入っている', colored > 100, `${colored}ピクセル`);
  execSync(`ffmpeg -v error -y -ss 2 -i ${v6File} -frames:v 1 ${path.join(OUT, '19b-exported-shapes.png')}`);
  // 拡大していない 10.5秒は左端が赤い帯、拡大した 12.5秒は左端が緑の帯（真ん中を2倍にしたので）
  const left = (f) => f(1, 18);
  const plain = left(frame6(10.5));
  const zoomed = left(frame6(12.5));
  check('書き出した動画が拡大されている', plain[0] > plain[1] && zoomed[1] > zoomed[0], `${JSON.stringify(plain)} → ${JSON.stringify(zoomed)}`);
  execSync(`ffmpeg -v error -y -ss 12.5 -i ${v6File} -frames:v 1 ${path.join(OUT, '22-exported-zoom.png')}`);
  // 2倍にした部分（8〜10秒）の音は 660Hz のまま（声の高さが変わらない）
  const zcr = (() => {
    const out = execSync(`ffmpeg -v info -ss 8.3 -t 1.4 -i ${v6File} -af astats=metadata=0 -f null - 2>&1`).toString();
    const m = /Zero crossings rate: ([\d.]+)/.exec(out);
    return m ? Number(m[1]) * 48000 / 2 : NaN;
  })();
  check('速さを変えても、音の高さは変わらない', zcr > 600 && zcr < 720, `${Math.round(zcr)}Hz`);
  await page.evaluate(() => window.__saveNames.push('v06.teroppa'));
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(500);
  const v6Saved = JSON.parse((await readOpfs(page, 'v06.teroppa')).toString('utf8'));
  check('作品ファイルに速さ・図形・拡大も入る', v6Saved.project.shapes.length === 2 && v6Saved.project.zooms.length === 1 && v6Saved.project.clips.some((c) => c.speed === 2));

  // 声の仕上げ（v0.7）
  await page.getByRole('button', { name: /編集に戻る/ }).click();
  await page.getByRole('button', { name: '新しく' }).click();
  await page.evaluate(() => window.__pickQueue.push(['g.webm']));
  await page.getByRole('button', { name: '録画を選ぶ' }).click();
  await page.waitForSelector('.toast');
  // 字幕ファイルで「えー」の行を入れておく
  await goStep(page, '字幕');
  await page.evaluate(() => window.__pickQueue.push(['g.srt']));
  await page.getByRole('button', { name: /字幕ファイル（.srt）を読み込む/ }).click();
  await page.waitForSelector('.sub-row');
  // 口ぐせ（試験的）
  await goStep(page, '「間」を切る');
  await page.getByRole('tab', { name: /えー/ }).click();
  await page.waitForSelector('text=候補を', { timeout: 60000 });
  const fillerRows = await page.locator('.item-list[aria-label="口ぐせの候補"] li').allInnerTexts();
  check('字幕の「えー」を、切る候補にする', fillerRows.some((r) => r.includes('字幕「えー」')), fillerRows.join(' / '));
  await page.screenshot({ path: path.join(OUT, '23-fillers.png') });
  const beforeFiller = sec(await timeText(page));
  await page.getByRole('button', { name: 'まとめて切る' }).click();
  await page.waitForSelector('text=短くなりました');
  const afterFiller = sec(await timeText(page));
  check('口ぐせをまとめて切ると短くなる', beforeFiller - afterFiller > 0.5 && beforeFiller - afterFiller < 1.5, `${beforeFiller} → ${afterFiller}`);
  await page.keyboard.press('Control+z');
  check('口ぐせを切ったのも元に戻せる', Math.abs(sec(await timeText(page)) - beforeFiller) < 0.05);
  // 声の大きさをそろえる・雑音を減らす
  await goStep(page, '音の仕上げ');
  await page.getByRole('tab', { name: '声' }).click();
  await page.waitForSelector('text=LUFS', { timeout: 60000 });
  await page.getByRole('button', { name: '声の大きさをそろえる' }).click();
  const normalizedNote = await page.locator('.sound-panel .note').first().innerText();
  check('声の大きさをそろえる', /g\.webm：[+-][\d.]+dB/.test(normalizedNote), normalizedNote);
  await page.getByRole('radiogroup', { name: '雑音を減らす強さ' }).getByRole('radio', { name: '強く' }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="雑音を減らす強さ"] [aria-checked="true"]')?.textContent === '強く', null, { timeout: 30000 });
  check('雑音を減らす設定にできる', true);
  await page.screenshot({ path: path.join(OUT, '24-voice.png') });
  // 再生してもエラーにならない（雑音を減らしながら鳴らす）
  await page.keyboard.press('Space');
  await page.waitForTimeout(1200);
  await page.keyboard.press('Space');
  const v7 = await exportTo(page, 'v07.mp4');
  const v7File = path.join(OUT, 'v07.mp4');
  check('声を仕上げた動画を書き出せる', Math.abs(Number(v7.format.duration) - 12) < 0.1, `${v7.format.duration}秒`);
  const stats = (file, from, len) => {
    const out = execSync(`ffmpeg -v info -ss ${from} -t ${len} -i ${file} -af astats=metadata=0 -f null - 2>&1`).toString().split('Overall')[1] ?? '';
    const num = (re) => {
      const m = re.exec(out);
      return m ? (m[1] === '-inf' ? -200 : Number(m[1])) : NaN;
    };
    return { rms: num(/RMS level dB: (-?[\d.]+|-inf)/), peak: num(/Peak level dB: (-?[\d.]+|-inf)/) };
  };
  const original = path.join(FIX, 'g.webm');
  const noiseBefore = stats(original, 7.3, 1);
  const noiseAfter = stats(v7File, 7.3, 1);
  const voiceBefore = stats(original, 5, 1.5);
  const voiceAfter = stats(v7File, 5, 1.5);
  // 声を大きくしたうえで、雑音は声よりも大きく減っている
  check(
    '雑音が減っている（声との差が広がる）',
    voiceAfter.rms - noiseAfter.rms > voiceBefore.rms - noiseBefore.rms + 6,
    `前：声${voiceBefore.rms.toFixed(1)}・雑音${noiseBefore.rms.toFixed(1)} → 後：声${voiceAfter.rms.toFixed(1)}・雑音${noiseAfter.rms.toFixed(1)}`,
  );
  const whole = stats(v7File, 0, 12);
  check('音が割れていない（一番大きいところが上限より下）', whole.peak <= -0.5, `${whole.peak}dB`);

  // AI のお手伝い（v0.8）。作業環境には Chrome の AI がないので、決まった答えを返す「まねした AI」で、テロッパ側の動きを確かめる
  await page.evaluate(() => {
    window.LanguageModel = {
      availability: async () => 'available',
      create: async () => ({
        prompt: async (text) => {
          if (text.includes('番号: 直した文')) return '2: ボスの弱点は背中です！';
          if (text.includes('見出しを1つ')) return 'ボスの話';
          if (text.includes('タイトルの案')) return 'タイトル案：\n1. ボスの弱点まとめ\n2. 背中を狙え\n3. 3分でわかるボス戦\n概要欄：\nボスの弱点を紹介します。';
          return '要点です';
        },
        destroy() {},
      }),
    };
  });
  await page.getByRole('button', { name: /次へ：公開の準備/ }).click();
  await page.waitForSelector('text=公開の準備をしましょう');
  // A「AIに聞く」：質問文をコピーして、選んだ AI のサイトを開く（貼り付け・送信は使う人が行う）
  await page.getByRole('button', { name: 'AIに聞く（AI のサイト）' }).click();
  await page.getByRole('radiogroup', { name: '使う AI のサイト' }).getByRole('radio', { name: 'Claude' }).click();
  check('AI のサイトに送る前に、送り先の会社を知らせる', (await page.locator('.ask-ai .note').innerText()).includes('Anthropic に送られます'));
  await page.getByRole('button', { name: '質問文をコピーして Claude を開く' }).click();
  const opened = await page.evaluate(() => window.__opened.slice());
  const copied = await page.evaluate(() => window.__copied.slice());
  check('質問文をコピーして AI のサイトを開く', opened[0] === 'https://claude.ai/new' && copied[0]?.includes('ボスの弱点は背中です'), opened.join(','));
  await page.getByRole('textbox', { name: 'AI の答えを貼る欄' }).fill('タイトル案：\n1. ボスの弱点を3分で解説\n概要欄：\nボスの倒し方を紹介します。');
  await page.getByRole('button', { name: '答えを読み込む' }).click();
  await page.locator('.chip', { hasText: 'ボスの弱点を3分で解説' }).click();
  check('AI の答えを貼ると、タイトルの案として使える', (await page.getByRole('textbox', { name: 'タイトル', exact: true }).inputValue()) === 'ボスの弱点を3分で解説');
  // C パソコンの中の AI（まねした AI）：はじめに案内を出す
  await page.getByRole('button', { name: 'このパソコンの AI で案を作る' }).click();
  check('パソコンの中の AI を使う前に、Google の禁止事項ポリシーを案内する', (await page.locator('.note.rights').innerText()).includes('禁止事項ポリシー'));
  await page.getByRole('button', { name: '了承して使う' }).click();
  await page.waitForSelector('.chip >> text=背中を狙え');
  check('パソコンの中の AI で、タイトルの案を作れる（まねした AI）', true);
  // チャプター：12秒の動画は短すぎるので、そう知らせる
  await page.getByRole('tab', { name: 'チャプター' }).click();
  await page.getByRole('button', { name: 'このパソコンの AI で案を作る' }).click();
  await page.waitForSelector('.chapter-list li');
  check('チャプターの案を作り、短すぎる動画ではそう知らせる', (await page.locator('.publish-panel .note.warn').innerText()).includes('短すぎ'));
  await page.screenshot({ path: path.join(OUT, '25-publish.png') });
  // 字幕の誤字直し（AIに聞く・答えを貼る）
  await goStep(page, '字幕');
  await page.getByRole('button', { name: 'AI で誤字を直す' }).click();
  await page.getByRole('radiogroup', { name: 'AI の使い方' }).getByRole('radio', { name: /AIに聞く/ }).click();
  await page.getByRole('textbox', { name: 'AI の答えを貼る欄' }).fill('2: ボスの弱点は背中です！\n9: ない行');
  await page.getByRole('button', { name: '答えを読み込む' }).click();
  await page.waitForSelector('.typo-list li');
  check('AI が直した案を、前と後で見せる', (await page.locator('.typo-list li').count()) === 1);
  await page.screenshot({ path: path.join(OUT, '26-typos.png') });
  await page.getByRole('button', { name: /選んだものを直す/ }).click();
  check('選んだ字幕だけを直せる', (await page.locator('.sub-row').nth(1).innerText()).includes('背中です！'));
  await page.keyboard.press('Control+z');
  check('AI で直したのも元に戻せる', !(await page.locator('.sub-row').nth(1).innerText()).includes('！'));
  // 調べもの・台本（上の「AIに聞く」）
  await page.getByRole('button', { name: 'AIに聞く', exact: true }).click();
  await page.getByRole('textbox', { name: '動画のテーマ' }).fill('ボスの倒し方');
  await page.getByRole('tab', { name: '台本の下書き' }).click();
  const scripted = await page
    .waitForFunction(() => document.querySelector('textarea[aria-label="AI への質問文"]')?.value.includes('台本の下書き'), null, { timeout: 5000 })
    .then(() => true, () => false);
  check('台本の下書きの質問文を作る', scripted);
  await page.getByRole('button', { name: '閉じる' }).last().click();

  // サムネイル（v0.9）
  await goStep(page, '公開の準備');
  await page.getByRole('tab', { name: 'サムネイル' }).click();
  await page.getByRole('button', { name: 'いまの場面でサムネイルを作る' }).click();
  await page.waitForSelector('canvas.thumbnail-preview');
  check('サムネイルの文字は、タイトルから始まる', (await page.getByRole('textbox', { name: 'サムネイルの文字' }).inputValue()) === 'ボスの弱点を3分で解説');
  await page.getByRole('textbox', { name: 'サムネイルの文字' }).fill('ボス戦\n攻略！');
  await page.waitForTimeout(800);
  const thumbPixels = (pred) =>
    page.evaluate((src) => {
      const f = new Function('r', 'g', 'b', `return ${src}`);
      const c = document.querySelector('canvas.thumbnail-preview');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 16) if (f(d[i], d[i + 1], d[i + 2])) n++;
      return n;
    }, pred);
  const yellow = await thumbPixels('r > 200 && g > 190 && b < 110');
  check('サムネイルに大きな文字が載る（インパクト：黄色い文字）', yellow > 500, `${yellow}`);
  await page.getByRole('radiogroup', { name: 'サムネイルの見た目' }).getByRole('radio', { name: 'ポップ' }).click();
  await page.waitForTimeout(500);
  const white = await thumbPixels('r > 240 && g > 240 && b > 240');
  const reddish = await thumbPixels('r > 200 && g < 90 && b < 90');
  check('見た目を変えられる（ポップ：白い文字に赤いふち）', white > 500 && reddish > 500, `白${white}・赤${reddish}`);
  await page.screenshot({ path: path.join(OUT, '27-thumbnail.png') });
  await page.evaluate(() => window.__saveNames.push('thumb.png'));
  await page.getByRole('button', { name: 'サムネイルを保存' }).click();
  await page.waitForSelector('text=保存しました');
  const thumbFile = path.join(OUT, 'thumb.png');
  fs.writeFileSync(thumbFile, await readOpfs(page, 'thumb.png'));
  const thumbInfo = probe(thumbFile).streams[0];
  check('サムネイルを PNG（1280×720）で保存できる', thumbInfo.codec_name === 'png' && thumbInfo.width === 1280 && thumbInfo.height === 720, `${thumbInfo.codec_name} ${thumbInfo.width}×${thumbInfo.height}`);
  await page.getByRole('radiogroup', { name: 'サムネイルの大きさ' }).getByRole('radio', { name: /1920/ }).click();
  await page.getByRole('radiogroup', { name: 'サムネイルの形式' }).getByRole('radio', { name: /JPEG/ }).click();
  await page.evaluate(() => window.__saveNames.push('thumb.jpg'));
  await page.getByRole('button', { name: 'サムネイルを保存' }).click();
  await page.waitForTimeout(1500);
  const jpgFile = path.join(OUT, 'thumb.jpg');
  fs.writeFileSync(jpgFile, await readOpfs(page, 'thumb.jpg'));
  const jpgInfo = probe(jpgFile).streams[0];
  check('サムネイルを JPEG（1920×1080）でも保存できる', jpgInfo.codec_name === 'mjpeg' && jpgInfo.width === 1920, `${jpgInfo.codec_name} ${jpgInfo.width}×${jpgInfo.height}`);
  // 場面を選び直す
  await page.getByRole('button', { name: '場面を選び直す' }).click();
  check('場面を選ぶ間は、サムネイルを隠して録画を見せる', (await page.locator('canvas.thumbnail-preview').count()) === 0);
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'この場面にする' }).click();
  await page.waitForSelector('canvas.thumbnail-preview');

  // 明るい画面・狭い画面
  await goStep(page, '書き出し');
  await page.getByRole('button', { name: /編集に戻る/ }).click();
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: path.join(OUT, '07-light.png') });
  await page.setViewportSize({ width: 1280, height: 650 });
  await goStep(page, '書き出し');
  await page.screenshot({ path: path.join(OUT, '08-export-small.png') });
  for (const width of [1920, 1366, 1280, 1000]) {
    await page.setViewportSize({ width, height: 700 });
    await page.waitForTimeout(150);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`横幅${width}でも画面が横にはみ出さない`, over <= 0, `${over}px`);
  }

  check('画面にエラーが出ていない', errors.length === 0, errors.join(' / '));
  await browser.close();
  console.log(failures === 0 ? `すべて OK（スクリーンショット：${OUT}）` : `${failures}件 NG`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
