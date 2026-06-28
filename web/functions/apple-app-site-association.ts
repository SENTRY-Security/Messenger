import type { PagesFunction } from '@cloudflare/workers-types';

export const onRequest: PagesFunction = async () => {
  const body = {
    applinks: {
      apps: [],
      details: [
        {
          appID: 'DYAAM5G8JF.red.sentry.app.SENTRY-Messenger',
          paths: ['*']
        }
      ]
    },
    // App Clip 預設體驗：NTAG424 連結可喚起 App Clip（未安裝完整 App 時）。
    appclips: {
      apps: ['DYAAM5G8JF.red.sentry.app.SENTRY-Messenger.Clip']
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
