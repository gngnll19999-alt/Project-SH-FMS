using Microsoft.AspNetCore.SignalR;

namespace SHFms.Server.Hubs;

/// <summary>
/// 브라우저 실시간 푸시 허브.
///
/// 폴링(setInterval + fetch)으로 하면 1초 주기 × 관제 PC 6대 × 태그 1,284개라
/// 서버가 쓸데없이 바빠진다. 푸시로 바꾸면 변화분만 나간다.
///
/// 채널
///   "tags"   : 태그 변화분 배열
///   "alarms" : 신규 알람 배열
///   "state"  : 수집기/게이트웨이 상태
///
/// 구독은 구역(Area) 단위 그룹으로 나눈다. A동 관제 PC 에 B동 태그를 보낼 이유가 없다.
/// </summary>
public class TagHub : Hub
{
    private readonly ILogger<TagHub> _log;

    public TagHub(ILogger<TagHub> log) => _log = log;

    public override async Task OnConnectedAsync()
    {
        _log.LogInformation("hub connected {Id}", Context.ConnectionId);
        await Groups.AddToGroupAsync(Context.ConnectionId, "all");
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? ex)
    {
        _log.LogInformation("hub disconnected {Id}", Context.ConnectionId);
        await base.OnDisconnectedAsync(ex);
    }

    /// <summary>구역 구독. 화면 전환 시 브라우저가 호출한다.</summary>
    public async Task SubscribeArea(string area)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, $"area:{area}");
    }

    public async Task UnsubscribeArea(string area)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, $"area:{area}");
    }
}
