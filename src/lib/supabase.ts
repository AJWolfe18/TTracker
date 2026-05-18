const host = window.location.hostname;
const labels = host.split('.');
const firstLabel = labels[0] || '';
const hasTestSubdomain = labels.slice(0, -1).includes('test');
const searchParams = new URLSearchParams(window.location.search);

export const isTest =
  hasTestSubdomain ||
  firstLabel.startsWith('test--') ||
  firstLabel.startsWith('deploy-preview-') ||
  searchParams.get('env') === 'test';

const TEST_URL = 'https://wnrjrywpcadwutfykflu.supabase.co';
const TEST_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InducmpyeXdwY2Fkd3V0ZnlrZmx1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUyMjA3MzcsImV4cCI6MjA3MDc5NjczN30.n-4DboHQSivt5GWx7X5wuaUsdmjsuJe0VgB18V-GxU4';

const PROD_URL = 'https://osjbulmltfpcoldydexg.supabase.co';
const PROD_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zamJ1bG1sdGZwY29sZHlkZXhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ3NjQ5NzEsImV4cCI6MjA3MDM0MDk3MX0.COtWEcun0Xkw5hUhaVEJGCrWbumj42L4vwWGgH7RyIE';

export const url = isTest ? TEST_URL : PROD_URL;
export const anonKey = isTest ? TEST_ANON_KEY : PROD_ANON_KEY;
