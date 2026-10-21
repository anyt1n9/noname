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
}

// ファイルを選ぶ画面・保存する場所を選ぶ画面の代わり
const stubPickers = () => {
  window.__pickQueue = [];
  window.__saveNames = [];
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

  for (const n of ['a.webm', 'b.mkv', 'c.webm', 'd.webm', 'e.mkv', 'subs.srt']) await putFixture(page, n);

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

  // 明るい画面・狭い画面
  await page.getByRole('button', { name: /編集に戻る/ }).click();
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: path.join(OUT, '07-light.png') });
  await page.setViewportSize({ width: 1280, height: 650 });
  await goStep(page, '書き出し');
  await page.screenshot({ path: path.join(OUT, '08-export-small.png') });

  check('画面にエラーが出ていない', errors.length === 0, errors.join(' / '));
  await browser.close();
  console.log(failures === 0 ? `すべて OK（スクリーンショット：${OUT}）` : `${failures}件 NG`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
