export const onRequest: PagesFunction = async () => {
  const body = {
    applinks: {
      apps: [],
      details: [
        {
          appID: 'HW8N8C46HG.red.sentry.messenger',
          // 使用通配符允許所有路徑，以涵蓋實際 NDEF URL。
          paths: ['*']
        }
      ]
    },
    // App Clip 預設體驗：NTAG424 連結可喚起 App Clip（未安裝完整 App 時）。
    appclips: {
      apps: ['HW8N8C46HG.red.sentry.messenger.Clip']
    }
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'max-age=3600'
    }
  });
};
