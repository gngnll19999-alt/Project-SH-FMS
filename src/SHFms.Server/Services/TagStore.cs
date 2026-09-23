using System.Collections.Concurrent;
using SHFms.Server.Models;

namespace SHFms.Server.Services;

/// <summary>
/// 현재값 저장소.
/// 수집기에서 올라온 값을 메모리에 들고 있다가 브라우저 요청에 즉시 응답한다.
/// 시계열은 Historian 이 따로 담당한다 (여기는 최신값만).
/// </summary>
public class TagStore
{
    private readonly ConcurrentDictionary<string, TagValue> _values = new();
    private readonly ConcurrentDictionary<string, TagMeta> _meta = new();
    private long _received;

    public long ReceivedTotal => Interlocked.Read(ref _received);
    public int TagCount => _values.Count;

    public void LoadMeta(IEnumerable<TagMeta> metas)
    {
        foreach (var m in metas) _meta[m.Tag] = m;
    }

    public TagMeta? Meta(string tag) => _meta.TryGetValue(tag, out var m) ? m : null;

    public void Apply(TagBatch batch)
    {
        foreach (var v in batch.Values)
        {
            _values[v.Tag] = v;
        }
        Interlocked.Add(ref _received, batch.Values.Count);
    }

    public TagSnapshot? Snapshot(string tag)
    {
        if (!_values.TryGetValue(tag, out var v)) return null;
        var m = Meta(tag);
        return new TagSnapshot(
            v.Tag,
            m?.Desc ?? "",
            m?.Unit ?? "",
            v.Value,
            v.Quality,
            v.Ts,
            StateOf(v, m));
    }

    public IEnumerable<TagSnapshot> All(string? area = null)
    {
        foreach (var kv in _values)
        {
            var m = Meta(kv.Key);
            if (area is not null && !string.Equals(m?.Area, area, StringComparison.OrdinalIgnoreCase))
                continue;
            yield return new TagSnapshot(
                kv.Value.Tag, m?.Desc ?? "", m?.Unit ?? "",
                kv.Value.Value, kv.Value.Quality, kv.Value.Ts,
                StateOf(kv.Value, m));
        }
    }

    /// <summary>
    /// 화면 색 결정에 쓰는 상태. ISA-101 에 맞춰 ok 는 무채색으로 그린다.
    /// 품질이 나쁘면 값 자체를 믿을 수 없으므로 한계값 판정보다 먼저 본다.
    /// </summary>
    private static string StateOf(TagValue v, TagMeta? m)
    {
        if (!string.Equals(v.Quality, "Good", StringComparison.OrdinalIgnoreCase)) return "bad";
        if (m is null) return "ok";

        if (m.HiHi is { } hh && v.Value >= hh) return "alarm";
        if (m.LoLo is { } ll && v.Value <= ll) return "alarm";
        if (m.Hi is { } h && v.Value >= h) return "warn";
        if (m.Lo is { } l && v.Value <= l) return "warn";
        return "ok";
    }
}
