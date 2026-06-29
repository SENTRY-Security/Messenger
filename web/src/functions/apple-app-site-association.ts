import type { PagesFunction } from '@cloudflare/workers-types';

export const onRequest: PagesFunction = async () => {
  const body = {
    applinks: {
      apps: [],
      details: [
        {
          appID: 'HW8N8C46HG.red.sentry.messenger',
          paths: ['*']
        }
      ]
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
