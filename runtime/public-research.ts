import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { z } from 'zod';

const MAX_SEARCH_RESULTS = 8;
const MAX_PAGE_BYTES = 512_000;
const MAX_TEXT_CHARS = 40_000;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;

export const PublicResearchRequestSchema = z.discriminatedUnion(
  'mode',
  [
    z.strictObject({
      mode: z.literal('search'),
      query: z.string().min(2).max(300)
    }),

    z.strictObject({
      mode: z.literal('fetch'),
      url: z.url().max(2_000)
    })
  ]
);

export type PublicResearchRequest =
  z.infer<typeof PublicResearchRequestSchema>;

export const PublicSearchResultSchema = z.strictObject({
  title: z.string().min(1).max(1_000),
  url: z.url().max(2_000),
  snippet: z.string().max(5_000)
});

export const PublicResearchResultSchema = z.discriminatedUnion(
  'mode',
  [
    z.strictObject({
      mode: z.literal('search'),
      query: z.string(),
      source: z.literal('duckduckgo-html'),
      results: z.array(PublicSearchResultSchema).max(
        MAX_SEARCH_RESULTS
      )
    }),

    z.strictObject({
      mode: z.literal('fetch'),
      requested_url: z.url(),
      final_url: z.url(),
      status: z.number().int(),
      content_type: z.string(),
      title: z.string().nullable(),
      text: z.string(),
      truncated: z.boolean()
    })
  ]
);

export type PublicResearchResult =
  z.infer<typeof PublicResearchResultSchema>;

function decodeHtml(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(
      /&#(\d+);/g,
      (_, value: string) =>
        String.fromCodePoint(
          Number.parseInt(value, 10)
        )
    );
}

function stripHtml(input: string): string {
  return decodeHtml(
    input
      .replace(
        /<script\b[^>]*>[\s\S]*?<\/script>/gi,
        ' '
      )
      .replace(
        /<style\b[^>]*>[\s\S]*?<\/style>/gi,
        ' '
      )
      .replace(
        /<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi,
        ' '
      )
      .replace(
        /<[^>]+>/g,
        ' '
      )
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function isPrivateIpv4(ip: string): boolean {
  const parts =
    ip
      .split('.')
      .map(Number);

  if (
    parts.length !== 4 ||
    parts.some(
      value =>
        !Number.isInteger(value) ||
        value < 0 ||
        value > 255
    )
  ) {
    return true;
  }

  const a = parts[0]!;
  const b = parts[1]!;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (
      a === 169 &&
      b === 254
    ) ||
    (
      a === 172 &&
      b >= 16 &&
      b <= 31
    ) ||
    (
      a === 192 &&
      b === 168
    ) ||
    (
      a === 100 &&
      b >= 64 &&
      b <= 127
    ) ||
    a >= 224
  );
}

function isPrivateIpv6(ip: string): boolean {
  const normalized =
    ip.toLowerCase();

  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  );
}

export function isPrivateAddress(
  address: string
): boolean {
  const family =
    isIP(address);

  if (family === 4) {
    return isPrivateIpv4(
      address
    );
  }

  if (family === 6) {
    return isPrivateIpv6(
      address
    );
  }

  return true;
}

export function validatePublicResearchUrl(
  raw: string
): URL {
  const url =
    new URL(raw);

  if (
    url.protocol !== 'https:'
  ) {
    throw new Error(
      'PUBLIC_RESEARCH_HTTPS_REQUIRED'
    );
  }

  if (
    url.username ||
    url.password
  ) {
    throw new Error(
      'PUBLIC_RESEARCH_CREDENTIALS_FORBIDDEN'
    );
  }

  if (
    url.port &&
    url.port !== '443'
  ) {
    throw new Error(
      'PUBLIC_RESEARCH_NONSTANDARD_PORT'
    );
  }

  const rawHost =
    url.hostname
      .toLowerCase()
      .replace(/\.$/, '');

  const host =
    rawHost.startsWith('[') &&
    rawHost.endsWith(']')
      ? rawHost.slice(1, -1)
      : rawHost;

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    throw new Error(
      'PUBLIC_RESEARCH_PRIVATE_HOST'
    );
  }

  if (
    isIP(host) &&
    isPrivateAddress(host)
  ) {
    throw new Error(
      'PUBLIC_RESEARCH_PRIVATE_HOST'
    );
  }

  return url;
}

async function assertPublicDns(
  url: URL
): Promise<void> {
  const addresses =
    await lookup(
      url.hostname,
      {
        all: true,
        verbatim: true
      }
    );

  if (
    addresses.length === 0
  ) {
    throw new Error(
      'PUBLIC_RESEARCH_DNS_EMPTY'
    );
  }

  for (
    const address
    of addresses
  ) {
    if (
      isPrivateAddress(
        address.address
      )
    ) {
      throw new Error(
        'PUBLIC_RESEARCH_PRIVATE_ADDRESS'
      );
    }
  }
}

async function boundedGet(
  raw: string,
  redirects = 0
): Promise<{
  response: Response;
  body: string;
  finalUrl: string;
  truncated: boolean;
}> {
  if (
    redirects >
    MAX_REDIRECTS
  ) {
    throw new Error(
      'PUBLIC_RESEARCH_TOO_MANY_REDIRECTS'
    );
  }

  const url =
    validatePublicResearchUrl(
      raw
    );

  await assertPublicDns(
    url
  );

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      REQUEST_TIMEOUT_MS
    );

  try {
    const response =
      await fetch(
        url,
        {
          method: 'GET',
          redirect: 'manual',
          signal:
            controller.signal,
          headers: {
            'user-agent':
              'SinkClones-PublicResearch/1.0 (+read-only)',
            accept:
              'text/html,text/plain,application/xhtml+xml;q=0.9'
          }
        }
      );

    if (
      response.status >= 300 &&
      response.status < 400
    ) {
      const location =
        response.headers.get(
          'location'
        );

      if (!location) {
        throw new Error(
          'PUBLIC_RESEARCH_REDIRECT_WITHOUT_LOCATION'
        );
      }

      const next =
        new URL(
          location,
          url
        );

      return boundedGet(
        next.toString(),
        redirects + 1
      );
    }

    const reader =
      response.body?.getReader();

    if (!reader) {
      return {
        response,
        body: '',
        finalUrl:
          response.url ||
          url.toString(),
        truncated: false
      };
    }

    let total = 0;
    let truncated = false;

    const chunks:
      Uint8Array[] = [];

    while (true) {
      const result =
        await reader.read();

      if (result.done) {
        break;
      }

      total +=
        result.value.byteLength;

      if (
        total >
        MAX_PAGE_BYTES
      ) {
        truncated = true;
        await reader.cancel();
        break;
      }

      chunks.push(
        result.value
      );
    }

    const bytes =
      Buffer.concat(
        chunks.map(
          chunk =>
            Buffer.from(chunk)
        )
      );

    return {
      response,
      body:
        bytes.toString(
          'utf8'
        ),
      finalUrl:
        response.url ||
        url.toString(),
      truncated
    };
  } finally {
    clearTimeout(timer);
  }
}

function unwrapDuckDuckGoUrl(
  raw: string
): string | null {
  try {
    const decoded =
      decodeHtml(raw);

    const url =
      new URL(
        decoded,
        'https://duckduckgo.com'
      );

    const redirect =
      url.searchParams.get(
        'uddg'
      );

    const candidate =
      redirect
        ? decodeURIComponent(
            redirect
          )
        : url.toString();

    return validatePublicResearchUrl(
      candidate
    ).toString();
  } catch {
    return null;
  }
}

export function parseDuckDuckGoHtml(
  html: string
): Array<{
  title: string;
  url: string;
  snippet: string;
}> {
  const results:
    Array<{
      title: string;
      url: string;
      snippet: string;
    }> = [];

  /*
   * Search result HTML is external, untrusted data.
   *
   * Parse anchor tags without assuming whether class or href
   * appears first. We intentionally do not execute scripts,
   * resolve relative non-public destinations or interpret page
   * instructions.
   */
  const anchorPattern =
    /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;

  let match:
    RegExpExecArray | null;

  while (
    (
      match =
        anchorPattern.exec(html)
    ) !== null
  ) {
    if (
      results.length >=
      MAX_SEARCH_RESULTS
    ) {
      break;
    }

    const attributes =
      match[1] ?? '';

    const body =
      match[2] ?? '';

    if (
      !/\bclass=["'][^"']*\bresult__a\b[^"']*["']/i
        .test(attributes)
    ) {
      continue;
    }

    const hrefMatch =
      attributes.match(
        /\bhref=["']([^"']+)["']/i
      );

    const href =
      hrefMatch?.[1];

    if (!href) {
      continue;
    }

    const url =
      unwrapDuckDuckGoUrl(
        href
      );

    if (!url) {
      continue;
    }

    const title =
      stripHtml(
        body
      );

    if (!title) {
      continue;
    }

    /*
     * Bound the snippet search so malformed HTML cannot make a
     * result consume arbitrary later document content.
     */
    const afterAnchor =
      html.slice(
        anchorPattern.lastIndex,
        anchorPattern.lastIndex +
          6_000
      );

    const snippetMatch =
      afterAnchor.match(
        /<([a-zA-Z0-9]+)\b[^>]*\bclass=["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i
      );

    const snippet =
      snippetMatch?.[2]
        ? stripHtml(
            snippetMatch[2]
          )
        : '';

    results.push({
      title:
        title.slice(
          0,
          1_000
        ),

      url,

      snippet:
        snippet.slice(
          0,
          5_000
        )
    });
  }

  return results;
}

async function searchPublicWeb(
  query: string
): Promise<PublicResearchResult> {
  const url =
    new URL(
      'https://html.duckduckgo.com/html/'
    );

  url.searchParams.set(
    'q',
    query
  );

  const response =
    await boundedGet(
      url.toString()
    );

  if (
    response.response.status < 200 ||
    response.response.status >= 300
  ) {
    throw new Error(
      `PUBLIC_RESEARCH_SEARCH_HTTP_${response.response.status}`
    );
  }

  return PublicResearchResultSchema.parse({
    mode: 'search',
    query,
    source:
      'duckduckgo-html',
    results:
      parseDuckDuckGoHtml(
        response.body
      )
  });
}

async function fetchPublicPage(
  raw: string
): Promise<PublicResearchResult> {
  const requested =
    validatePublicResearchUrl(
      raw
    );

  const result =
    await boundedGet(
      requested.toString()
    );

  const contentType =
    result.response.headers
      .get('content-type') ??
    '';

  if (
    !contentType.includes(
      'text/html'
    ) &&
    !contentType.includes(
      'text/plain'
    ) &&
    !contentType.includes(
      'application/xhtml+xml'
    )
  ) {
    throw new Error(
      'PUBLIC_RESEARCH_UNSUPPORTED_CONTENT_TYPE'
    );
  }

  const titleMatch =
    result.body.match(
      /<title[^>]*>([\s\S]*?)<\/title>/i
    );

  const text =
    stripHtml(
      result.body
    );

  return PublicResearchResultSchema.parse({
    mode: 'fetch',
    requested_url:
      requested.toString(),

    final_url:
      validatePublicResearchUrl(
        result.finalUrl
      ).toString(),

    status:
      result.response.status,

    content_type:
      contentType,

    title:
      titleMatch
        ? stripHtml(
            titleMatch[1]
          ).slice(
            0,
            1_000
          )
        : null,

    text:
      text.slice(
        0,
        MAX_TEXT_CHARS
      ),

    truncated:
      result.truncated ||
      text.length >
        MAX_TEXT_CHARS
  });
}

export async function publicResearch(
  raw: PublicResearchRequest
): Promise<PublicResearchResult> {
  const request =
    PublicResearchRequestSchema.parse(
      raw
    );

  if (
    request.mode ===
    'search'
  ) {
    return searchPublicWeb(
      request.query
    );
  }

  return fetchPublicPage(
    request.url
  );
}
