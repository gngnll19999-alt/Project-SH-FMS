using System.Collections.Concurrent;
using SHFms.Server.Models;

namespace SHFms.Server.Services;

/// <summary>
/// 시계열 저장소 (인메모리 링버퍼).
///
/// 운영에서는 TimescaleDB 로 뺀다. 여기서 인메모리로 두는 이유는
/// 1차 오픈 범위가 "관제 화면이 보이는 것"까지이고, DB 도입은 인프라 승인이 걸려 있어서다.
/// 조회 인터페이스(Query)는 DB 로 바꿔도 그대로 쓸 수 있게 잡아 두었다.
///
/// 상위 시스템(MES/ERP)은 SCADA 서버가 아니라 이 히스토리안의 읽기전용 API 로만 붙는다.
/// </summary>
public class Historian
{
    private const int PerTagCapacity = 21600;   // 1초 × 6시간

    private readonly ConcurrentDictionary<string, RingBuffer> _series = new();

    public void Write(IEnumerable<TagValue> values)
    {
        foreach (var v in values)
        {
            var buf = _series.GetOrAdd(v.Tag, _ => new RingBuffer(PerTagCapacity));
            buf.Add(v.Ts, v.Value);
        }
    }

    /// <summary>구간 조회. 포인트 수가 많으면 균등 샘플링해서 돌려준다.</summary>
    public IReadOnlyList<(long Ts, double Value)> Query(string tag, long fromMs, long toMs, int maxPoints = 600)
    {
        if (!_series.TryGetValue(tag, out var buf)) return Array.Empty<(long, double)>();

        var raw = buf.Range(fromMs, toMs);
        if (raw.Count <= maxPoints) return raw;

        // 화면에 600점 넘게 그려 봐야 픽셀이 겹친다. 전송량만 늘 뿐이다.
        var step = (double)raw.Count / maxPoints;
        var outp = new List<(long, double)>(maxPoints);
        for (var i = 0; i < maxPoints; i++) outp.Add(raw[(int)(i * step)]);
        return outp;
    }

    public (double Min, double Max, double Avg, int Count) Stats(string tag, long fromMs, long toMs)
    {
        var r = Query(tag, fromMs, toMs, int.MaxValue);
        if (r.Count == 0) return (0, 0, 0, 0);
        return (r.Min(x => x.Value), r.Max(x => x.Value), r.Average(x => x.Value), r.Count);
    }

    public int SeriesCount => _series.Count;

    private sealed class RingBuffer
    {
        private readonly long[] _ts;
        private readonly double[] _val;
        private readonly int _cap;
        private int _head;
        private int _count;
        private readonly object _lock = new();

        public RingBuffer(int cap)
        {
            _cap = cap;
            _ts = new long[cap];
            _val = new double[cap];
        }

        public void Add(long ts, double v)
        {
            lock (_lock)
            {
                _ts[_head] = ts;
                _val[_head] = v;
                _head = (_head + 1) % _cap;
                if (_count < _cap) _count++;
            }
        }

        public List<(long, double)> Range(long from, long to)
        {
            lock (_lock)
            {
                var res = new List<(long, double)>();
                var start = (_head - _count + _cap) % _cap;
                for (var i = 0; i < _count; i++)
                {
                    var idx = (start + i) % _cap;
                    if (_ts[idx] >= from && _ts[idx] <= to) res.Add((_ts[idx], _val[idx]));
                }
                return res;
            }
        }
    }
}
