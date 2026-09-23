namespace SHFms.Server.Models;

/// <summary>
/// 품질 코드. C++ 수집기(tag.h Quality)와 문자열로 맞춰 두었다.
/// 한쪽을 고치면 반대쪽도 같이 고쳐야 한다.
/// </summary>
public enum Quality
{
    Good,
    Uncertain,
    Bad
}

/// <summary>수집기가 올려 보내는 태그 1건.</summary>
public record TagValue(
    string Tag,
    double Value,
    string Quality,
    long Ts);

/// <summary>수집기 → 게이트웨이 배치 요청 본문.</summary>
public record TagBatch(
    string Source,
    List<TagValue> Values);

/// <summary>브라우저로 내려보내는 태그 스냅샷.</summary>
public record TagSnapshot(
    string Tag,
    string Desc,
    string Unit,
    double Value,
    string Quality,
    long Ts,
    string State);       // ok | warn | alarm | bad

/// <summary>태그 메타 정보. 알람 한계값도 여기 들어 있다.</summary>
public class TagMeta
{
    public string Tag { get; set; } = "";
    public string Desc { get; set; } = "";
    public string Unit { get; set; } = "";
    public string Area { get; set; } = "";

    public double? LoLo { get; set; }
    public double? Lo { get; set; }
    public double? Hi { get; set; }
    public double? HiHi { get; set; }

    /// <summary>알람 채터링 방지용 히스테리시스. 한계값 복귀 판정에 쓴다.</summary>
    public double Deadband { get; set; }

    /// <summary>P1(긴급) / P2(높음) / P3(낮음)</summary>
    public int Priority { get; set; } = 2;
}
