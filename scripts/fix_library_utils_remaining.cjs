'use strict';
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'library-utils.js');
let code = fs.readFileSync(filePath, 'utf8');

// 1. Lines 3736 & 3896: catch without binding
code = code.replace(
  "    } catch {\n      return '';\n    }",
  "    } catch (_e) {\n      return '';\n    }"
);
code = code.replace(
  "    } catch {\n      return '';\n    }",
  "    } catch (_e) {\n      return '';\n    }"
);

// 2. Lines 12418-12420:
code = code.replace(
  "const rawTok = rawInput.access_token ?? rawInput.accessToken ?? rawInput.token ?? '';",
  "const rawTok = rawInput.access_token != null ? rawInput.access_token : (rawInput.accessToken != null ? rawInput.accessToken : (rawInput.token != null ? rawInput.token : ''));"
);
code = code.replace(
  "const expiresInSeconds = parseExpires(rawInput.expires_in ?? rawInput.expiresIn ?? rawInput.expiresInSeconds);",
  "const exp1 = rawInput.expires_in != null ? rawInput.expires_in : (rawInput.expiresIn != null ? rawInput.expiresIn : rawInput.expiresInSeconds);\n      const expiresInSeconds = parseExpires(exp1);"
);

// 3. Lines 12449-12451:
code = code.replace(
  "const rawTok = parsedObj.access_token ?? parsedObj.accessToken ?? parsedObj.token ?? '';",
  "const rawTok = parsedObj.access_token != null ? parsedObj.access_token : (parsedObj.accessToken != null ? parsedObj.accessToken : (parsedObj.token != null ? parsedObj.token : ''));"
);
code = code.replace(
  "const expiresInSeconds = parseExpires(parsedObj.expires_in ?? parsedObj.expiresIn ?? parsedObj.expiresInSeconds);",
  "const exp2 = parsedObj.expires_in != null ? parsedObj.expires_in : (parsedObj.expiresIn != null ? parsedObj.expiresIn : parsedObj.expiresInSeconds);\n        const expiresInSeconds = parseExpires(exp2);"
);

// 4. Line 19196:
code = code.replace(
  `[opts.decodedDurationSec, opts.audioBuffer, trackMeta.decodedDuration, trackMeta.decodedDurationSec, trackMeta.audioDuration].find(x => x != null) ??\n      trackMeta.audioBuffer`,
  `(function () { const found = [opts.decodedDurationSec, opts.audioBuffer, trackMeta.decodedDuration, trackMeta.decodedDurationSec, trackMeta.audioDuration].find(x => x != null); return found != null ? found : trackMeta.audioBuffer; })()`
);

// 5. Lines 26882-26886:
code = code.replace(
  `gainL = Number.isFinite(Number(item.gainL ?? item.leftGain))
          ? Number(item.gainL ?? item.leftGain)
          : baseGain;
        gainR = Number.isFinite(Number(item.gainR ?? item.rightGain))
          ? Number(item.gainR ?? item.rightGain)
          : baseGain;`,
  `const rawGL = item.gainL != null ? item.gainL : item.leftGain;
        gainL = Number.isFinite(Number(rawGL))
          ? Number(rawGL)
          : baseGain;
        const rawGR = item.gainR != null ? item.gainR : item.rightGain;
        gainR = Number.isFinite(Number(rawGR))
          ? Number(rawGR)
          : baseGain;`
);

fs.writeFileSync(filePath, code, 'utf8');
console.log('Finished updating remaining lines in library-utils.js');
