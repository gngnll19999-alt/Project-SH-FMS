namespace SHFms.Server.Models;

/// <summary>ISA-18.2 알람 상태 천이.</summary>
public enum AlarmState
{
    Normal,           // 정상
    UnackActive,      // 발생, 미확인
    AckActive,        // 발생, 확인됨
    UnackCleared,     // 해소되었으나 미확인 (운전원이 놓친 알람을 남긴다)
    Shelved           // 셸빙 (운전원이 일시적으로 내려둔 상태)
}

public enum AlarmType
{
    PVHH,   // 상한상한
    PVH,    // 상한
    PVL,    // 하한
    PVLL,   // 하한하한
    BAD,    // 통신/품질 불량
    DEV     // 설정값 편차
}

public class AlarmEvent
{
    public string Id { get; set; } = "";
    public string Tag { get; set; } = "";
    public string Area { get; set; } = "";
    public int Priority { get; set; }
    public AlarmType Type { get; set; }
    public string Message { get; set; } = "";

    public DateTimeOffset RaisedAt { get; set; }
    public DateTimeOffset? AckedAt { get; set; }
    public DateTimeOffset? ClearedAt { get; set; }

    public string? AckedBy { get; set; }
    public AlarmState State { get; set; } = AlarmState.UnackActive;

    /// <summary>셸빙 자동 해제 시각. ISA-18.2 는 무기한 셸빙을 금지한다.</summary>
    public DateTimeOffset? ShelfExpiresAt { get; set; }

    public double Value { get; set; }
    public double Limit { get; set; }
}

/// <summary>알람 부하 KPI. ISA-18.2 권고치와 비교하는 용도.</summary>
public record AlarmLoad(
    int Last24h,
    int LastHour,
    int UnackCount,
    int ShelvedCount,
    int TargetPerHour,
    int TargetPerDay);
