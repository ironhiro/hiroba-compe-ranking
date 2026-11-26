// 관리 페이지용 GitHub Contents API 클라이언트.
// 토큰은 운영자 브라우저의 localStorage에만 저장된다(이 레포 Contents 읽기/쓰기만 준 fine-grained 토큰 권장).

const API = 'https://api.github.com';
const BASE64_CHUNK = 0x8000;
const STORAGE_KEY = 'hcr-admin-github';

const encodeBase64 = (text) => {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(binary);
};

const decodeBase64 = (base64) => {
  const binary = atob(base64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (ch) => ch.charCodeAt(0)));
};

/** github.io 주소면 owner/repo를 추정한다. */
export function guessRepo() {
  const owner = location.hostname.endsWith('.github.io') ? location.hostname.split('.')[0] : '';
  const repo = owner ? location.pathname.split('/').filter(Boolean)[0] ?? `${owner}.github.io` : '';
  return { owner, repo };
}

export function loadSettings() {
  try {
    return { branch: 'main', ...guessRepo(), ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') };
  } catch {
    return { branch: 'main', ...guessRepo() };
  }
}

export const saveSettings = (settings) => localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
export const forgetSettings = () => localStorage.removeItem(STORAGE_KEY);
export const isReady = (s) => Boolean(s?.owner && s?.repo && s?.branch && s?.token);

const contentsUrl = ({ owner, repo }, path) =>
  `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;

const headers = (token) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
});

/** 파일 읽기. 없으면 { json: null, sha: null } */
export async function readJson(settings, path) {
  const res = await fetch(`${contentsUrl(settings, path)}?ref=${encodeURIComponent(settings.branch)}`, {
    headers: headers(settings.token),
    cache: 'no-store',
  });
  if (res.status === 404) return { json: null, sha: null };
  if (!res.ok) throw new Error(`GitHub 읽기 실패 (HTTP ${res.status})`);
  const body = await res.json();
  return { json: JSON.parse(decodeBase64(body.content)), sha: body.sha };
}

/** 파일 쓰기. sha가 다르면(다른 사람이 먼저 저장) 409/422로 실패한다. */
export async function writeJson(settings, path, json, sha, message) {
  const res = await fetch(contentsUrl(settings, path), {
    method: 'PUT',
    headers: { ...headers(settings.token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      branch: settings.branch,
      content: encodeBase64(`${JSON.stringify(json, null, 1)}\n`),
      ...(sha ? { sha } : {}),
    }),
  });
  if (res.status === 409 || res.status === 422) {
    throw new Error('다른 곳에서 먼저 저장했습니다. "GitHub에서 다시 불러오기" 후 다시 입력해 주세요.');
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(`GitHub 저장 실패 (HTTP ${res.status}${detail?.message ? `: ${detail.message}` : ''})`);
  }
  return (await res.json()).content?.sha ?? null;
}
