import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isPrivateAddress,
  parseDuckDuckGoHtml,
  validatePublicResearchUrl
} from '../runtime/public-research.js';

test(
  'public research rejects non-HTTPS and credentialed URLs',
  () => {
    assert.throws(
      () =>
        validatePublicResearchUrl(
          'http://example.com'
        )
    );

    assert.throws(
      () =>
        validatePublicResearchUrl(
          'https://user:pass@example.com/'
        )
    );

    assert.equal(
      validatePublicResearchUrl(
        'https://example.com/path'
      ).hostname,
      'example.com'
    );
  }
);

test(
  'public research blocks local and private network destinations',
  () => {
    const blocked = [
      'https://localhost/',
      'https://127.0.0.1/',
      'https://10.0.0.1/',
      'https://192.168.1.1/',
      'https://172.16.0.1/',
      'https://169.254.169.254/',
      'https://[::1]/'
    ];

    for (
      const value
      of blocked
    ) {
      assert.throws(
        () =>
          validatePublicResearchUrl(
            value
          )
      );
    }

    assert.equal(
      isPrivateAddress(
        '8.8.8.8'
      ),
      false
    );
  }
);

test(
  'DuckDuckGo HTML parser extracts public HTTPS evidence candidates',
  () => {
    const html = `
      <div class="result">
        <a class="result__a"
           href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpricing">
           Example Pricing
        </a>
        <div class="result__snippet">
          Packages start from A$500.
        </div>
      </div>
    `;

    const results =
      parseDuckDuckGoHtml(
        html
      );

    assert.equal(
      results.length,
      1
    );

    assert.equal(
      results[0]?.url,
      'https://example.com/pricing'
    );

    assert.match(
      results[0]?.snippet ?? '',
      /A\$500/
    );
  }
);

test(
  'public research blocks nonstandard ports',
  () => {
    assert.throws(
      () =>
        validatePublicResearchUrl(
          'https://example.com:8443/'
        )
    );
  }
);
