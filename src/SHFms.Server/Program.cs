// SH-FMS 게이트웨이
//
// 역할
//   1. C++ 수집기가 올리는 태그 배치를 받는다
//   2. ISA-18.2 알람 엔진으로 평가한다
//   3. 히스토리안에 적재한다
//   4. SignalR 로 관제 화면에 푸시한다
//
// 이 서버는 읽기 전용이다. 설비 제어 명령은 취급하지 않는다.
// 제어는 SCADA/PLC 권한이고, 감시 시스템이 쓰기 경로를 갖는 순간
// 보안 심사와 안전 검토가 완전히 다른 등급이 된다. (2026-07-24 설계 검토)

using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using SHFms.Server.Hubs;
using SHFms.Server.Models;
using SHFms.Server.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSignalR();
builder.Services.AddSingleton<TagStore>();
builder.Services.AddSingleton<Historian>();
builder.Services.AddSingleton<AlarmEngine>();

// 관제 화면이 별도 포트(정적 서버)에서 뜨는 경우가 있어 사내망만 열어 둔다.
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins("http://localhost:8080", "http://localhost:8803", "http://127.0.0.1:8803")
    .AllowAnyHeader()
    .AllowAnyMethod()
    .AllowCredentials()));

var app = builder.Build();

app.UseCors();
app.UseDefaultFiles();
app.UseStaticFiles();   // 관제 화면을 같은 서버에서 서빙할 때 사용

// ---------------------------------------------------------------- 태그 메타 로드
var store = app.Services.GetRequiredService<TagStore>();
var alarms = app.Services.GetRequiredService<AlarmEngine>();
var historian = app.Services.GetRequiredService<Historian>();
var log = app.Services.GetRequiredService<ILogger<Program>>();

LoadAlarmConfig(store, log);

// ---------------------------------------------------------------- 인증
// 수집기는 API 키로만 붙는다. 제어망 안이라 이 정도로 충분하다는 판단.
// 사무망 노출이 생기면 mTLS 로 올려야 한다.
var apiKey = builder.Configuration["Collector:ApiKey"] ?? "CHANGE-ME-BEFORE-DEPLOY";

// ---------------------------------------------------------------- 수집 엔드포인트
app.MapPost("/api/v1/tags/batch", async (
    HttpRequest req,
    TagBatch batch,
    TagStore tags,
    AlarmEngine engine,
    Historian hist,
    IHubContext<TagHub> hub) =>
{
    if (req.Headers["X-Api-Key"] != apiKey)
        return Results.Unauthorized();

    if (batch.Values.Count == 0)
        return Results.Ok(new { received = 0 });

    tags.Apply(batch);
    hist.Write(batch.Values);

    var fired = engine.Evaluate(batch.Values);

    await hub.Clients.All.SendAsync("tags", batch.Values);
    if (fired.Count > 0)
        await hub.Clients.All.SendAsync("alarms", fired);

    return Results.Ok(new { received = batch.Values.Count, alarms = fired.Count });
});

// ---------------------------------------------------------------- 조회 API
app.MapGet("/api/v1/tags", (TagStore tags, string? area) =>
    Results.Ok(tags.All(area)));

app.MapGet("/api/v1/tags/{tag}", (TagStore tags, string tag) =>
{
    var s = tags.Snapshot(tag);
    return s is null ? Results.NotFound() : Results.Ok(s);
});

app.MapGet("/api/v1/history/{tag}", (Historian hist, string tag, long? from, long? to, int? points) =>
{
    var now = DateTimeOffset.Now.ToUnixTimeMilliseconds();
    var f = from ?? now - 3600_000;
    var t = to ?? now;
    var data = hist.Query(tag, f, t, points ?? 600);
    var st = hist.Stats(tag, f, t);
    return Results.Ok(new
    {
        tag,
        from = f,
        to = t,
        count = data.Count,
        stats = new { st.Min, st.Max, st.Avg, st.Count },
        points = data.Select(p => new { ts = p.Ts, v = p.Value })
    });
});

// ---------------------------------------------------------------- 알람 API
app.MapGet("/api/v1/alarms", (AlarmEngine engine) => Results.Ok(engine.Active));
app.MapGet("/api/v1/alarms/history", (AlarmEngine engine, int? take) => Results.Ok(engine.History(take ?? 200)));
app.MapGet("/api/v1/alarms/load", (AlarmEngine engine) => Results.Ok(engine.Load()));
app.MapGet("/api/v1/alarms/top", (AlarmEngine engine, int? take) => Results.Ok(engine.TopOffenders(take ?? 10)));

app.MapPost("/api/v1/alarms/{id}/ack", async (
    AlarmEngine engine, IHubContext<TagHub> hub, string id, AckRequest body) =>
{
    if (string.IsNullOrWhiteSpace(body.User)) return Results.BadRequest(new { error = "user required" });
    if (!engine.Ack(id, body.User)) return Results.NotFound();
    await hub.Clients.All.SendAsync("alarmAck", new { id, body.User });
    return Results.Ok(new { id, acked = true });
});

app.MapPost("/api/v1/alarms/{id}/shelve", async (
    AlarmEngine engine, IHubContext<TagHub> hub, string id, ShelveRequest body) =>
{
    if (string.IsNullOrWhiteSpace(body.User)) return Results.BadRequest(new { error = "user required" });
    var dur = TimeSpan.FromMinutes(body.Minutes <= 0 ? 120 : body.Minutes);
    if (!engine.Shelve(id, body.User, dur)) return Results.NotFound();
    await hub.Clients.All.SendAsync("alarmShelve", new { id, body.User, minutes = dur.TotalMinutes });
    return Results.Ok(new { id, shelved = true, until = DateTimeOffset.Now + dur });
});

// 상태기반 억제. 설비 정지 구간에는 그 설비 알람을 띄우지 않는다.
app.MapPost("/api/v1/alarms/suppress", (AlarmEngine engine, SuppressRequest body) =>
{
    engine.Suppress(body.Key, body.On);
    return Results.Ok(new { body.Key, body.On });
});

// ---------------------------------------------------------------- 상태
app.MapGet("/api/v1/health", (TagStore tags, AlarmEngine engine, Historian hist) => Results.Ok(new
{
    status = "ok",
    serverTime = DateTimeOffset.Now,
    tagCount = tags.TagCount,
    receivedTotal = tags.ReceivedTotal,
    activeAlarms = engine.Active.Count,
    series = hist.SeriesCount
}));

app.MapHub<TagHub>("/hub/tags");

log.LogInformation("SH-FMS gateway listening. tags meta loaded: {N}", store.TagCount);
app.Run();


// ---------------------------------------------------------------- 로컬 함수 / 타입
static void LoadAlarmConfig(TagStore store, ILogger log)
{
    var path = Path.Combine(AppContext.BaseDirectory, "config", "alarms.json");
    if (!File.Exists(path))
    {
        log.LogWarning("alarm config not found: {Path} — 한계값 판정 없이 기동합니다", path);
        return;
    }

    try
    {
        var json = File.ReadAllText(path);
        var metas = JsonSerializer.Deserialize<List<TagMeta>>(json, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        });
        if (metas is null || metas.Count == 0)
        {
            log.LogWarning("alarm config is empty");
            return;
        }
        store.LoadMeta(metas);
        log.LogInformation("alarm config loaded: {N} tags", metas.Count);
    }
    catch (Exception ex)
    {
        // 설정이 깨졌으면 기동은 하되 크게 남긴다. 알람이 조용히 안 뜨는 게 제일 위험하다.
        log.LogError(ex, "alarm config load failed — 알람 판정이 동작하지 않습니다");
    }
}

record AckRequest(string User);
record ShelveRequest(string User, int Minutes);
record SuppressRequest(string Key, bool On);
