using System.Collections.Concurrent;
using SHFms.Server.Models;

namespace SHFms.Server.Services;

/// <summary>
/// ISA-18.2 알람 엔진.
///
/// 핵심은 "알람을 많이 띄우는 것"이 아니라 "쓸데없는 알람을 안 띄우는 것"이다.
/// 1차 시스템은 한계값을 넘을 때마다 새 알람을 만들어서, 값이 경계에서 떨릴 때
/// 같은 알람이 분당 수십 건씩 쌓였다. 여기서는 세 가지로 막는다.
///
///  1) 활성 알람 중복 억제 — 이미 떠 있는 알람은 다시 만들지 않는다
///  2) 히스테리시스 — 한계값에서 deadband 만큼 되돌아와야 해소로 본다
///  3) 상태기반 억제 — 설비가 정지 상태면 그 설비 알람은 조치 불가이므로 억제
/// </summary>
public class AlarmEngine
{
    private readonly TagStore _tags;
    private readonly ILogger<AlarmEngine> _log;

    // 태그별 활성 알람 (태그당 1건만 활성 유지)
    private readonly ConcurrentDictionary<string, AlarmEvent> _active = new();

    // 이력. 운영에서는 DB 로 뺀다. 여기서는 최근 5,000건만 메모리에 둔다.
    private readonly ConcurrentQueue<AlarmEvent> _history = new();
    private const int HistoryLimit = 5000;

    // 상태기반 억제 대상 구역/설비
    private readonly HashSet<string> _suppressed = new(StringComparer.OrdinalIgnoreCase);

    private long _seq;

    public AlarmEngine(TagStore tags, ILogger<AlarmEngine> log)
    {
        _tags = tags;
        _log = log;
    }

    public IReadOnlyCollection<AlarmEvent> Active =>
        _active.Values.OrderBy(a => a.Priority).ThenByDescending(a => a.RaisedAt).ToList();

    public IReadOnlyCollection<AlarmEvent> History(int take = 200) =>
        _history.Reverse().Take(take).ToList();

    /// <summary>설비 정지 등으로 조치가 불가능한 구간에는 알람을 억제한다.</summary>
    public void Suppress(string key, bool on)
    {
        lock (_suppressed)
        {
            if (on) _suppressed.Add(key);
            else _suppressed.Remove(key);
        }
        _log.LogInformation("alarm suppression {Key} = {On}", key, on);
    }

    private bool IsSuppressed(TagMeta m)
    {
        lock (_suppressed)
        {
            if (_suppressed.Count == 0) return false;
            // 태그 접두사(설비 코드) 또는 구역 단위로 억제
            var eq = m.Tag.Split('_')[0];
            return _suppressed.Contains(eq) || _suppressed.Contains(m.Area);
        }
    }

    public List<AlarmEvent> Evaluate(IEnumerable<TagValue> values)
    {
        var fired = new List<AlarmEvent>();

        foreach (var v in values)
        {
            var m = _tags.Meta(v.Tag);
            if (m is null) continue;
            if (IsSuppressed(m)) continue;

            var (type, limit) = Classify(v, m);

            if (type is null)
            {
                TryClear(v, m);
                continue;
            }

            // 이미 같은 유형의 알람이 떠 있으면 새로 만들지 않는다 (중복 억제)
            if (_active.TryGetValue(v.Tag, out var cur) && cur.Type == type.Value)
            {
                cur.Value = v.Value;
                continue;
            }

            var ev = new AlarmEvent
            {
                Id = NextId(),
                Tag = v.Tag,
                Area = m.Area,
                Priority = PriorityOf(type.Value, m),
                Type = type.Value,
                Message = Describe(type.Value, m, v.Value, limit),
                RaisedAt = DateTimeOffset.Now,
                State = AlarmState.UnackActive,
                Value = v.Value,
                Limit = limit
            };

            _active[v.Tag] = ev;
            Push(ev);
            fired.Add(ev);

            _log.LogWarning("ALARM P{Pri} {Tag} {Msg}", ev.Priority, ev.Tag, ev.Message);
        }

        ExpireShelves();
        return fired;
    }

    private static (AlarmType?, double) Classify(TagValue v, TagMeta m)
    {
        if (!string.Equals(v.Quality, "Good", StringComparison.OrdinalIgnoreCase))
            return (AlarmType.BAD, 0);

        if (m.HiHi is { } hh && v.Value >= hh) return (AlarmType.PVHH, hh);
        if (m.LoLo is { } ll && v.Value <= ll) return (AlarmType.PVLL, ll);
        if (m.Hi is { } h && v.Value >= h) return (AlarmType.PVH, h);
        if (m.Lo is { } l && v.Value <= l) return (AlarmType.PVL, l);
        return (null, 0);
    }

    /// <summary>
    /// 해소 판정. 한계값을 단순히 되돌아왔다고 바로 풀면 경계에서 떨릴 때 알람이 홍수가 난다.
    /// deadband 만큼 확실히 들어와야 해소로 본다.
    /// </summary>
    private void TryClear(TagValue v, TagMeta m)
    {
        if (!_active.TryGetValue(v.Tag, out var ev)) return;

        var db = m.Deadband;
        bool cleared = ev.Type switch
        {
            AlarmType.PVHH or AlarmType.PVH => v.Value <= ev.Limit - db,
            AlarmType.PVLL or AlarmType.PVL => v.Value >= ev.Limit + db,
            AlarmType.BAD => string.Equals(v.Quality, "Good", StringComparison.OrdinalIgnoreCase),
            _ => true
        };
        if (!cleared) return;

        ev.ClearedAt = DateTimeOffset.Now;

        // 운전원이 확인하지 않은 채 해소된 알람은 목록에 남겨 둔다.
        // 아무도 모르게 사라지면 무슨 일이 있었는지 아무도 모른다.
        if (ev.State == AlarmState.UnackActive)
        {
            ev.State = AlarmState.UnackCleared;
        }
        else
        {
            ev.State = AlarmState.Normal;
            _active.TryRemove(v.Tag, out _);
        }

        _log.LogInformation("alarm cleared {Tag} ({State})", ev.Tag, ev.State);
    }

    public bool Ack(string id, string user)
    {
        var ev = _active.Values.FirstOrDefault(a => a.Id == id);
        if (ev is null) return false;

        ev.AckedAt = DateTimeOffset.Now;
        ev.AckedBy = user;

        if (ev.State == AlarmState.UnackCleared)
        {
            ev.State = AlarmState.Normal;
            _active.TryRemove(ev.Tag, out _);
        }
        else
        {
            ev.State = AlarmState.AckActive;
        }

        _log.LogInformation("alarm acked {Id} by {User}", id, user);
        return true;
    }

    /// <summary>셸빙. 무기한 금지라 만료시각을 반드시 넣는다.</summary>
    public bool Shelve(string id, string user, TimeSpan duration)
    {
        var ev = _active.Values.FirstOrDefault(a => a.Id == id);
        if (ev is null) return false;

        if (duration > TimeSpan.FromHours(8)) duration = TimeSpan.FromHours(8);

        ev.State = AlarmState.Shelved;
        ev.ShelfExpiresAt = DateTimeOffset.Now + duration;
        ev.AckedBy = user;

        _log.LogWarning("alarm shelved {Id} by {User} until {Until}", id, user, ev.ShelfExpiresAt);
        return true;
    }

    private void ExpireShelves()
    {
        var now = DateTimeOffset.Now;
        foreach (var ev in _active.Values)
        {
            if (ev.State == AlarmState.Shelved && ev.ShelfExpiresAt is { } exp && now >= exp)
            {
                ev.State = AlarmState.UnackActive;
                ev.ShelfExpiresAt = null;
                _log.LogWarning("shelf expired, alarm re-activated {Id} {Tag}", ev.Id, ev.Tag);
            }
        }
    }

    public AlarmLoad Load()
    {
        var now = DateTimeOffset.Now;
        var all = _history.ToArray();
        return new AlarmLoad(
            Last24h: all.Count(a => (now - a.RaisedAt).TotalHours <= 24),
            LastHour: all.Count(a => (now - a.RaisedAt).TotalHours <= 1),
            UnackCount: _active.Values.Count(a => a.State == AlarmState.UnackActive),
            ShelvedCount: _active.Values.Count(a => a.State == AlarmState.Shelved),
            TargetPerHour: 6,      // ISA-18.2 권고
            TargetPerDay: 300);
    }

    /// <summary>빈발 알람(nuisance alarm) 상위. 알람 합리화의 출발점.</summary>
    public IEnumerable<object> TopOffenders(int take = 10) =>
        _history
            .GroupBy(a => a.Tag)
            .Select(g => new { tag = g.Key, count = g.Count(), lastAt = g.Max(x => x.RaisedAt) })
            .OrderByDescending(x => x.count)
            .Take(take);

    private static int PriorityOf(AlarmType t, TagMeta m) => t switch
    {
        AlarmType.PVHH or AlarmType.PVLL => 1,
        AlarmType.BAD => 2,
        _ => m.Priority
    };

    private static string Describe(AlarmType t, TagMeta m, double v, double limit)
    {
        var unit = string.IsNullOrEmpty(m.Unit) ? "" : " " + m.Unit;
        return t switch
        {
            AlarmType.PVHH => $"{m.Desc} 상한상한 초과 ({v:0.##}{unit} / HH {limit:0.##}{unit})",
            AlarmType.PVH => $"{m.Desc} 상한 초과 ({v:0.##}{unit} / H {limit:0.##}{unit})",
            AlarmType.PVL => $"{m.Desc} 하한 미달 ({v:0.##}{unit} / L {limit:0.##}{unit})",
            AlarmType.PVLL => $"{m.Desc} 하한하한 미달 ({v:0.##}{unit} / LL {limit:0.##}{unit})",
            AlarmType.BAD => $"{m.Desc} 통신 품질 불량 — 값 신뢰 불가",
            _ => $"{m.Desc} 설정값 편차"
        };
    }

    private string NextId()
    {
        var n = Interlocked.Increment(ref _seq);
        return $"AL-{DateTime.Now:yyMMdd}-{n:0000}";
    }

    private void Push(AlarmEvent ev)
    {
        _history.Enqueue(ev);
        while (_history.Count > HistoryLimit) _history.TryDequeue(out _);
    }
}
