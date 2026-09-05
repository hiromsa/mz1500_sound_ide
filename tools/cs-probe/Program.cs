// ============================================================================
// C# 版音源エミュレーション (MzSound.Player/Chips) のリファレンス値ダンプツール。
// TypeScript 移植 (src/core/chips) とのビット一致検証 (web_core_port.md §4) 用。
// 使い方: dotnet run --project tools/cs-probe -c Release
// 出力:   tools/cs-probe/out/reference.json
// ============================================================================
using System.Text.Json;
using MzSound.Player.Chips;

// bin/<Configuration>/net9.0-windows/ から 3 つ上 = tools/cs-probe/
var outDir = Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "out");
Directory.CreateDirectory(outDir);
var outPath = Path.Combine(outDir, "reference.json");

// --- 1. System.Random(1234).Next(32768) の先頭 16 値 (OPM LFO ノイズ用) ---
var random = new Random(1234);
var randomValues = Enumerable.Range(0, 16).Select(_ => random.Next(32768)).ToArray();

// --- 2. DcsgChip: トーン A4 (period 253) / 減衰 0 (ノイズは無音) を 200 標本 ---
var dcsg = new DcsgChip();
dcsg.SetTonePeriod(0, 253);
dcsg.SetAttenuation(0, 0);
dcsg.SetAttenuation(3, 15);
var dcsgSamples = new List<double>();
for (var i = 0; i < 200; i++)
{
    dcsgSamples.Add(dcsg.RenderSample(48000.0));
}

// --- 2b. DcsgChip ノイズ: white / rate 0 (トーンは無音) を 100 標本 ---
var dcsgNoise = new DcsgChip();
dcsgNoise.SetAttenuation(0, 15);
dcsgNoise.SetAttenuation(1, 15);
dcsgNoise.SetAttenuation(2, 15);
dcsgNoise.SetNoiseControl(white: true, rate: 0);
var dcsgNoiseSamples = new List<double>();
for (var i = 0; i < 100; i++)
{
    dcsgNoiseSamples.Add(dcsgNoise.RenderSample(48000.0));
}

// --- 3. BeepChip: counter 2034 (A4) / gate ON を 48 標本 ---
var beep = new BeepChip();
beep.SetCounter(2034);
beep.SetGate(true);
var beepSamples = new List<double>();
for (var i = 0; i < 96; i++)
{
    beepSamples.Add(beep.RenderSample(48000.0));
}

// --- 4. Ym2151: C# テスト (Ym2151_ProducesOutputAfterKeyOn) と同一条件 ---
var fm = new Ym2151(cpuClockHz: 3579545);
fm.Initialize(48000);
fm.SetReg(0x20, 0xC4); // PAN 両方 / FB=0 / ALG=4
for (var op = 0; op < 4; op++)
{
    fm.SetReg(0x40 + (op << 3), 0x01); // MUL=1
    fm.SetReg(0x60 + (op << 3), 0x00); // TL=0 (最大音量)
    fm.SetReg(0x80 + (op << 3), 0x1F); // KS=0 / AR=31
    fm.SetReg(0xA0 + (op << 3), 0x00); // D1R=0
    fm.SetReg(0xC0 + (op << 3), 0x00); // DT2=0 / D2R=0
    fm.SetReg(0xE0 + (op << 3), 0xF0); // D1L=15 / RR=0
}

fm.SetReg(0x28, 0x4C); // KC = A4
fm.SetReg(0x30, 0x00); // KF = 0
fm.SetReg(0x08, 0x78); // Key On (channel 0 / 4 op)

var buffer = new int[9600];
var partials = new List<int>();
for (var block = 0; block < 10; block++)
{
    fm.Mix(buffer.AsSpan(block * 960, 960), 480);
    var m = 0;
    for (var i = 0; i < 960; i++)
    {
        m = Math.Max(m, Math.Abs(buffer[block * 960 + i]));
    }

    partials.Add(m);
}

long fmSum = 0;
foreach (var v in buffer)
{
    fmSum += v;
}

var fmHead = buffer.Take(48).ToArray();

// --- 5. Ym2151 + saw LFO (PMS=7 / PMD=127 / AMD=127) 1000 標本 ---
var fmLfo = new Ym2151(cpuClockHz: 3579545);
fmLfo.Initialize(48000);
fmLfo.SetReg(0x20, 0xC7); // ALG=7 (4 op 並列)
for (var op = 0; op < 4; op++)
{
    fmLfo.SetReg(0x40 + (op << 3), 0x01);
    fmLfo.SetReg(0x60 + (op << 3), 0x00);
    fmLfo.SetReg(0x80 + (op << 3), 0x1F);
    fmLfo.SetReg(0xC0 + (op << 3), 0x00);
    fmLfo.SetReg(0xE0 + (op << 3), 0xF0);
}

fmLfo.SetReg(0x28, 0x4C);
fmLfo.SetReg(0x38, 0x70); // PMS=7 / AMS=0 (AMON 無効: AMS 最大深度は log 域で無音になるため PMS のみ検証)
fmLfo.SetReg(0x18, 0x08); // LFRQ
fmLfo.SetReg(0x19, 0x7F); // PMD=127
fmLfo.SetReg(0x19, 0xFF); // AMD=127 (AMON 無効なので実効なし)
fmLfo.SetReg(0x1B, 0x00); // W = saw
fmLfo.SetReg(0x08, 0x78);

var lfoBuffer = new int[2000];
fmLfo.Mix(lfoBuffer.AsSpan(0, 2000), 1000);
long lfoSum = 0;
foreach (var v in lfoBuffer)
{
    lfoSum += v;
}

var lfoHead = lfoBuffer.Take(32).ToArray();

// --- 6. Ym2151 + noise LFO (W=3): System.Random 互換乱数の間接検証 ---
var fmNoiseLfo = new Ym2151(cpuClockHz: 3579545);
fmNoiseLfo.Initialize(48000);
fmNoiseLfo.SetReg(0x20, 0xC7);
for (var op = 0; op < 4; op++)
{
    fmNoiseLfo.SetReg(0x40 + (op << 3), 0x01);
    fmNoiseLfo.SetReg(0x60 + (op << 3), 0x00);
    fmNoiseLfo.SetReg(0x80 + (op << 3), 0x1F);
    fmNoiseLfo.SetReg(0xE0 + (op << 3), 0xF0);
}

fmNoiseLfo.SetReg(0x28, 0x4C);
fmNoiseLfo.SetReg(0x38, 0x70); // PMS=7 / AMS=0
fmNoiseLfo.SetReg(0x18, 0x08);
fmNoiseLfo.SetReg(0x19, 0x7F);
fmNoiseLfo.SetReg(0x19, 0xFF);
fmNoiseLfo.SetReg(0x1B, 0x03); // W = noise
fmNoiseLfo.SetReg(0x08, 0x78);

var noiseLfoBuffer = new int[2000];
fmNoiseLfo.Mix(noiseLfoBuffer.AsSpan(0, 2000), 1000);
long noiseLfoSum = 0;
foreach (var v in noiseLfoBuffer)
{
    noiseLfoSum += v;
}

var reference = new
{
    randomValues,
    dcsgSamples,
    dcsgNoiseSamples,
    beepSamples,
    fm = new { partials, sum = fmSum, head = fmHead },
    lfo = new { sum = lfoSum, head = lfoHead },
    noiseLfo = new { sum = noiseLfoSum, head = noiseLfoBuffer.Take(16).ToArray() },
};

var options = new JsonSerializerOptions { WriteIndented = true };
File.WriteAllText(outPath, JsonSerializer.Serialize(reference, options));
Console.WriteLine($"written: {outPath}");
