'use strict';
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'library-utils.js');
let code = fs.readFileSync(filePath, 'utf8');

// 1. version bump in buildServiceWorkerCacheManifest
code = code.replace("version = 'nocturne-v2.1.2'", "version = 'nocturne-v2.1.3'");

// 2. Specific replacements for library-utils.js lines:
// L14: const normalize = value => String(value ?? '').replace(/\s+/gu, ' ').trim();
code = code.replace(
  "const normalize = value => String(value ?? '').replace(/\\s+/gu, ' ').trim();",
  "const normalize = value => String(value != null ? value : '').replace(/\\s+/gu, ' ').trim();"
);

// L38: const number = String(candidate ?? '').match(/\d+/)?.[0];
code = code.replace(
  "const number = String(candidate ?? '').match(/\\d+/)?.[0];",
  "const m38 = String(candidate != null ? candidate : '').match(/\\d+/); const number = m38 ? m38[0] : undefined;"
);

// L72: const taggedTrackNumber = String(trackNumberCandidate ?? '').match(/\d+/)?.[0] || '';
code = code.replace(
  "const taggedTrackNumber = String(trackNumberCandidate ?? '').match(/\\d+/)?.[0] || '';",
  "const m72 = String(trackNumberCandidate != null ? trackNumberCandidate : '').match(/\\d+/); const taggedTrackNumber = (m72 && m72[0]) || '';"
);

// L109: const albumTag = tags.album ?? tags.albums ?? tags.ALBUM ?? tags.TALB;
code = code.replace(
  "const albumTag = tags.album ?? tags.albums ?? tags.ALBUM ?? tags.TALB;",
  "const albumTag = tags.album != null ? tags.album : (tags.albums != null ? tags.albums : (tags.ALBUM != null ? tags.ALBUM : tags.TALB));"
);

// L1094: const presetLabel = options.eqPreset ? (options.eqPresetLabels?.[options.eqPreset] || options.eqPreset) : 'Tùy chỉnh';
code = code.replace(
  "const presetLabel = options.eqPreset ? (options.eqPresetLabels?.[options.eqPreset] || options.eqPreset) : 'Tùy chỉnh';",
  "const presetLabel = options.eqPreset ? ((options.eqPresetLabels && options.eqPresetLabels[options.eqPreset]) || options.eqPreset) : 'Tùy chỉnh';"
);

// L1661: if (!curTrack || !curTrack.album) return Math.max(0, Math.round((curTrack?.duration || 0) - (Number(currentTrackPlaybackSec) || 0)));
code = code.replace(
  "if (!curTrack || !curTrack.album) return Math.max(0, Math.round((curTrack?.duration || 0) - (Number(currentTrackPlaybackSec) || 0)));",
  "if (!curTrack || !curTrack.album) return Math.max(0, Math.round(((curTrack && curTrack.duration) || 0) - (Number(currentTrackPlaybackSec) || 0)));"
);

// L1690, 1696, 1699: ambientBaseVolume ?? 0.3
code = code.replace(
  "musicGain * (options.ambientBaseVolume ?? 0.3) : 0;",
  "musicGain * (options.ambientBaseVolume != null ? options.ambientBaseVolume : 0.3) : 0;"
);
code = code.replace(
  "Math.max(0, Math.min(1, transitionProgress)) * (options.ambientBaseVolume ?? 0.3);",
  "Math.max(0, Math.min(1, transitionProgress)) * (options.ambientBaseVolume != null ? options.ambientBaseVolume : 0.3);"
);
code = code.replace(
  "return { stage: 'active', musicGain: 1.0, ambientGain: options.ambientScene ? (options.ambientBaseVolume ?? 0.3) * 0.5 : 0 };",
  "return { stage: 'active', musicGain: 1.0, ambientGain: options.ambientScene ? (options.ambientBaseVolume != null ? options.ambientBaseVolume : 0.3) * 0.5 : 0 };"
);

// L2221, 2227: const pCount = Number(stats.playCount ?? track.playCount ?? 0);
code = code.replace(
  "const pCount = Number(stats.playCount ?? track.playCount ?? 0);",
  "const pCount = Number(stats.playCount != null ? stats.playCount : (track.playCount != null ? track.playCount : 0));"
);
code = code.replace(
  "const pCount = Number(stats.playCount ?? track.playCount ?? 0);",
  "const pCount = Number(stats.playCount != null ? stats.playCount : (track.playCount != null ? track.playCount : 0));"
);

// L3373: : (Number(track?.duration) > 0 ? Number(track.duration) : rawDur);
code = code.replace(
  ": (Number(track?.duration) > 0 ? Number(track.duration) : rawDur);",
  ": (Number(track && track.duration) > 0 ? Number(track.duration) : rawDur);"
);

// L3736: } catch {
code = code.replace(
  "} catch {\n      return null;\n    }",
  "} catch (_e) {\n      return null;\n    }"
);

// L3760, 3761:
// const bitDepth = Number(stream?.BitDepth ?? stream?.bitDepth) || 16;
// const sampleRate = Number(stream?.SampleRate ?? stream?.sampleRate) || 44100;
code = code.replace(
  "const bitDepth = Number(stream?.BitDepth ?? stream?.bitDepth) || 16;",
  "const rawBitDepth = stream ? (stream.BitDepth != null ? stream.BitDepth : stream.bitDepth) : null;\n    const bitDepth = Number(rawBitDepth) || 16;"
);
code = code.replace(
  "const sampleRate = Number(stream?.SampleRate ?? stream?.sampleRate) || 44100;",
  "const rawSampleRate = stream ? (stream.SampleRate != null ? stream.SampleRate : stream.sampleRate) : null;\n    const sampleRate = Number(rawSampleRate) || 44100;"
);

// L3894: } catch {
code = code.replace(
  "} catch {\n    return null;\n  }",
  "} catch (_e) {\n    return null;\n  }"
);

// L3914: const cover = rawSong.album_image_urls?.large || rawSong.album_image_urls?.medium || rawSong.album_image_urls?.small;
code = code.replace(
  "const cover = rawSong.album_image_urls?.large || rawSong.album_image_urls?.medium || rawSong.album_image_urls?.small;",
  "const imgUrls = rawSong.album_image_urls;\n    const cover = imgUrls ? (imgUrls.large || imgUrls.medium || imgUrls.small) : null;"
);

// L4414: const prevIntensity = Number(prevStrobe?.intensity) || 0;
code = code.replace(
  "const prevIntensity = Number(prevStrobe?.intensity) || 0;",
  "const prevIntensity = Number(prevStrobe && prevStrobe.intensity) || 0;"
);

// L4448: const intensity = Number(strobe?.intensity) || 0;
code = code.replace(
  "const intensity = Number(strobe?.intensity) || 0;",
  "const intensity = Number(strobe && strobe.intensity) || 0;"
);

// L4528, 4529: minBin, maxBin
code = code.replace(
  "const minFreqIdx = Math.max(1, Math.floor(Number(options?.minBin) || 1));",
  "const minFreqIdx = Math.max(1, Math.floor(Number(options && options.minBin) || 1));"
);
code = code.replace(
  "const maxFreqIdx = Math.min(dataLen, Math.floor(Number(options?.maxBin) || dataLen));",
  "const maxFreqIdx = Math.min(dataLen, Math.floor(Number(options && options.maxBin) || dataLen));"
);

// L4555, 4556: attackRate, decayRate
code = code.replace(
  "const attack = Math.max(0.1, Math.min(0.99, Number(options?.attackRate) || 0.72));",
  "const attack = Math.max(0.1, Math.min(0.99, Number(options && options.attackRate) || 0.72));"
);
code = code.replace(
  "const decay = Math.max(0.1, Math.min(0.99, Number(options?.decayRate) || 0.86));",
  "const decay = Math.max(0.1, Math.min(0.99, Number(options && options.decayRate) || 0.86));"
);

// L4585: sensitivity
code = code.replace(
  "const sensitivity = Math.max(0.5, Math.min(2.5, Number(options?.sensitivity) || 1.0));",
  "const sensitivity = Math.max(0.5, Math.min(2.5, Number(options && options.sensitivity) || 1.0));"
);

// L4595: primaryColor
code = code.replace(
  "colorHex: options?.primaryColor || '#c084fc'",
  "colorHex: (options && options.primaryColor) || '#c084fc'"
);

// L4606: timeSeconds
code = code.replace(
  "const timeSec = Number(options?.timeSeconds) || (Date.now() / 1000);",
  "const timeSec = Number(options && options.timeSeconds) || (Date.now() / 1000);"
);

// L7076: roomProfile?.id
code = code.replace(
  "const profile = getRoomAcousticProfile(typeof roomProfile === 'string' ? roomProfile : (roomProfile?.id || 'bypass'));",
  "const profile = getRoomAcousticProfile(typeof roomProfile === 'string' ? roomProfile : ((roomProfile && roomProfile.id) || 'bypass'));"
);

// L7488: (clickedTrackId.id ?? clickedTrackId._id ?? clickedTrackId.trackId ?? clickedTrackId)
code = code.replace(
  "? (clickedTrackId.id ?? clickedTrackId._id ?? clickedTrackId.trackId ?? clickedTrackId)",
  "? (clickedTrackId.id != null ? clickedTrackId.id : (clickedTrackId._id != null ? clickedTrackId._id : (clickedTrackId.trackId != null ? clickedTrackId.trackId : clickedTrackId)))"
);

// L7494: (track.id ?? track._id ?? track.trackId ?? track)
code = code.replace(
  "? (track.id ?? track._id ?? track.trackId ?? track)",
  "? (track.id != null ? track.id : (track._id != null ? track._id : (track.trackId != null ? track.trackId : track)))"
);

// L7512: (t.id ?? t._id ?? t.trackId ?? t)
code = code.replace(
  "return typeof t === 'object' ? (t.id ?? t._id ?? t.trackId ?? t) : t;",
  "return typeof t === 'object' && t ? (t.id != null ? t.id : (t._id != null ? t._id : (t.trackId != null ? t.trackId : t))) : t;"
);

// L7550: Number(options?.repeat ?? 0)
code = code.replace(
  ": Number(options?.repeat ?? 0);",
  ": Number((options && options.repeat != null) ? options.repeat : 0);"
);

// L7556: (currentTrackId.id ?? currentTrackId._id ?? currentTrackId.trackId ?? currentTrackId)
code = code.replace(
  "? (currentTrackId.id ?? currentTrackId._id ?? currentTrackId.trackId ?? currentTrackId)",
  "? (currentTrackId.id != null ? currentTrackId.id : (currentTrackId._id != null ? currentTrackId._id : (currentTrackId.trackId != null ? currentTrackId.trackId : currentTrackId)))"
);

// L7562: (track.id ?? track._id ?? track.trackId ?? track)
code = code.replace(
  "? (track.id ?? track._id ?? track.trackId ?? track)",
  "? (track.id != null ? track.id : (track._id != null ? track._id : (track.trackId != null ? track.trackId : track)))"
);

// L7704: (currentTrack.id ?? currentTrack._id ?? currentTrack.trackId ?? currentTrack)
code = code.replace(
  "? (currentTrack.id ?? currentTrack._id ?? currentTrack.trackId ?? currentTrack)",
  "? (currentTrack.id != null ? currentTrack.id : (currentTrack._id != null ? currentTrack._id : (currentTrack.trackId != null ? currentTrack.trackId : currentTrack)))"
);

// L7708: (t.id ?? t._id ?? t.trackId ?? t)
code = code.replace(
  "const tid = typeof t === 'object' ? (t.id ?? t._id ?? t.trackId ?? t) : t;",
  "const tid = typeof t === 'object' && t ? (t.id != null ? t.id : (t._id != null ? t._id : (t.trackId != null ? t.trackId : t))) : t;"
);

// L7716: currentTrack.trackNumber ?? currentTrack.track_no ?? currentTrack.track
code = code.replace(
  "const trackNo = currentTrack.trackNumber ?? currentTrack.track_no ?? currentTrack.track;",
  "const trackNo = currentTrack.trackNumber != null ? currentTrack.trackNumber : (currentTrack.track_no != null ? currentTrack.track_no : currentTrack.track);"
);

// L7964: t.file?.name
code = code.replace(
  "const pathOrUrl = t.file?.name || t.name || t.url || `${artist} - ${title}.flac`;",
  "const pathOrUrl = (t.file && t.file.name) || t.name || t.url || `${artist} - ${title}.flac`;"
);

// L8934, 8935, 8936: prevStrobe?.bassIntensity
code = code.replace(
  "const prevBass = Number(prevStrobe?.bassIntensity) || 0;\n    const prevVocal = Number(prevStrobe?.vocalIntensity) || 0;\n    const prevTreble = Number(prevStrobe?.trebleIntensity) || 0;",
  "const prevBass = Number(prevStrobe && prevStrobe.bassIntensity) || 0;\n    const prevVocal = Number(prevStrobe && prevStrobe.vocalIntensity) || 0;\n    const prevTreble = Number(prevStrobe && prevStrobe.trebleIntensity) || 0;"
);

// L9246, 9247, 9248: trackId, title, artist
code = code.replace(
  "const trackId = track?.id || meta.id || 'unknown';\n    const title = meta.title || track?.title || 'Unknown Title';\n    const artist = meta.artist || track?.artist || UNKNOWN_ARTIST;",
  "const trackId = (track && track.id) || meta.id || 'unknown';\n    const title = meta.title || (track && track.title) || 'Unknown Title';\n    const artist = meta.artist || (track && track.artist) || UNKNOWN_ARTIST;"
);

// L9984, 9985, 9986: healthReport.score ?? 100
code = code.replace(
  "const score = healthReport.score ?? 100;\n    const ratio = healthReport.compressionRatio ?? 0;\n    const tokens = healthReport.totalTokens ?? 0;",
  "const score = healthReport.score != null ? healthReport.score : 100;\n    const ratio = healthReport.compressionRatio != null ? healthReport.compressionRatio : 0;\n    const tokens = healthReport.totalTokens != null ? healthReport.totalTokens : 0;"
);

// L10228: deltaReport.bandwidthSavingsPercent ?? 0
code = code.replace(
  "const s = deltaReport.bandwidthSavingsPercent ?? 0;",
  "const s = deltaReport.bandwidthSavingsPercent != null ? deltaReport.bandwidthSavingsPercent : 0;"
);

// L10233-10237: storageEstimate, options
code = code.replace(
  "const quota = Number(storageEstimate?.quota) || 0;\n    const usage = Number(storageEstimate?.usage) || 0;\n    const safetyMargin = Number(options?.safetyMarginBytes) || (200 * 1024 * 1024);\n    const avgFlac = Number(options?.avgFlacSizeBytes) || (35 * 1024 * 1024);\n    const avgMp3 = Number(options?.avgMp3SizeBytes) || (8 * 1024 * 1024);",
  "const quota = Number(storageEstimate && storageEstimate.quota) || 0;\n    const usage = Number(storageEstimate && storageEstimate.usage) || 0;\n    const safetyMargin = Number(options && options.safetyMarginBytes) || (200 * 1024 * 1024);\n    const avgFlac = Number(options && options.avgFlacSizeBytes) || (35 * 1024 * 1024);\n    const avgMp3 = Number(options && options.avgMp3SizeBytes) || (8 * 1024 * 1024);"
);

// L10658: options?.maxBudgetBytes
code = code.replace(
  "const maxBudgetBytes = Number(options?.maxBudgetBytes) || (256 * 1024 * 1024);",
  "const maxBudgetBytes = Number(options && options.maxBudgetBytes) || (256 * 1024 * 1024);"
);

// L10687, 10695, 10699: options?.forceEviction
code = code.replace(
  "if (pressureLevel === 'critical' || options?.forceEviction) {",
  "if (pressureLevel === 'critical' || (options && options.forceEviction)) {"
);
code = code.replace(
  "if (remainingBytes <= targetBytes && !options?.forceEviction) break;",
  "if (remainingBytes <= targetBytes && !(options && options.forceEviction)) break;"
);
code = code.replace(
  "if (options?.forceEviction && evictionKeys.length >= (options.maxEvictCount || 50)) break;",
  "if ((options && options.forceEviction) && evictionKeys.length >= (options.maxEvictCount || 50)) break;"
);

// L11035: stats.completionRate ?? 1
code = code.replace(
  "const completionRate = Math.max(0, Math.min(1, Number(stats.completionRate ?? 1)));",
  "const completionRate = Math.max(0, Math.min(1, Number(stats.completionRate != null ? stats.completionRate : 1)));"
);

// L11127-11129:
code = code.replace(
  "playCount: tStats.playCount ?? t.playCount ?? 0,\n        skipCount: tStats.skipCount ?? t.skipCount ?? 0,\n        completionRate: tStats.completionRate ?? 1,",
  "playCount: tStats.playCount != null ? tStats.playCount : (t.playCount != null ? t.playCount : 0),\n        skipCount: tStats.skipCount != null ? tStats.skipCount : (t.skipCount != null ? t.skipCount : 0),\n        completionRate: tStats.completionRate != null ? tStats.completionRate : 1,"
);

// L11148, 11149:
code = code.replace(
  "const pCount = Number(tStats.playCount ?? t.playCount ?? 0);\n      const sCount = Number(tStats.skipCount ?? t.skipCount ?? 0);",
  "const pCount = Number(tStats.playCount != null ? tStats.playCount : (t.playCount != null ? t.playCount : 0));\n      const sCount = Number(tStats.skipCount != null ? tStats.skipCount : (t.skipCount != null ? t.skipCount : 0));"
);

// L11196:
code = code.replace(
  "const uRating = Number(options.userRating ?? track.rating ?? 0);",
  "const uRating = Number(options.userRating != null ? options.userRating : (track.rating != null ? track.rating : 0));"
);

// L12415, 12417:
code = code.replace(
  "const rawTok = rawInput.access_token ?? rawInput.accessToken ?? rawInput.token ?? '';\n      const expiresInSeconds = parseExpires(rawInput.expires_in ?? rawInput.expiresIn ?? rawInput.expiresInSeconds);",
  "const rawTok = rawInput.access_token != null ? rawInput.access_token : (rawInput.accessToken != null ? rawInput.accessToken : (rawInput.token != null ? rawInput.token : ''));\n      const expiresInSeconds = parseExpires(rawInput.expires_in != null ? rawInput.expires_in : (rawInput.expiresIn != null ? rawInput.expiresIn : rawInput.expiresInSeconds));"
);

// L12446, 12448:
code = code.replace(
  "const rawTok = parsedObj.access_token ?? parsedObj.accessToken ?? parsedObj.token ?? '';\n        const expiresInSeconds = parseExpires(parsedObj.expires_in ?? parsedObj.expiresIn ?? parsedObj.expiresInSeconds);",
  "const rawTok = parsedObj.access_token != null ? parsedObj.access_token : (parsedObj.accessToken != null ? parsedObj.accessToken : (parsedObj.token != null ? parsedObj.token : ''));\n        const expiresInSeconds = parseExpires(parsedObj.expires_in != null ? parsedObj.expires_in : (parsedObj.expiresIn != null ? parsedObj.expiresIn : parsedObj.expiresInSeconds));"
);

// L13349, 13353:
code = code.replace(
  ": (hdrs['retry-after'] ?? hdrs['Retry-After'] ?? null);",
  ": (hdrs['retry-after'] != null ? hdrs['retry-after'] : (hdrs['Retry-After'] != null ? hdrs['Retry-After'] : null));"
);
code = code.replace(
  "rawHeader = rawHeader['retry-after'] ?? rawHeader['Retry-After'] ?? null;",
  "rawHeader = rawHeader['retry-after'] != null ? rawHeader['retry-after'] : (rawHeader['Retry-After'] != null ? rawHeader['Retry-After'] : null);"
);

// L13390, 13420, 13506, 13786, 13810:
code = code.replace("const str = String(rawVal ?? '').trim();", "const str = String(rawVal != null ? rawVal : '').trim();");
code = code.replace("const str = String(value ?? '');", "const str = String(value != null ? value : '');");
code = code.replace(
  "const val = isRawDecoded ? String(rawVal ?? '') : decodeLyricsfileYamlScalar(rawVal);",
  "const val = isRawDecoded ? String(rawVal != null ? rawVal : '') : decodeLyricsfileYamlScalar(rawVal);"
);
code = code.replace("const text = String(line.text ?? '');", "const text = String(line.text != null ? line.text : '');");
code = code.replace(
  "out.push(`        text: ${encodeLyricsfileYamlString(word.text ?? '')}`);",
  "out.push(`        text: ${encodeLyricsfileYamlString(word.text != null ? word.text : '')}`);"
);

// L16670:
code = code.replace(
  "const primaryTarget = (typeof eventLike.composedPath === 'function' ? eventLike.composedPath()?.[0] : null) || eventLike.target;",
  "const primaryTarget = (typeof eventLike.composedPath === 'function' && eventLike.composedPath() ? eventLike.composedPath()[0] : null) || eventLike.target;"
);

// L17029, 17050: band.q ?? band.Q
code = code.replace(
  "band ? (band.q ?? band.Q) : undefined,",
  "band ? (band.q != null ? band.q : band.Q) : undefined,"
);
code = code.replace(
  "band ? (band.q ?? band.Q) : undefined,",
  "band ? (band.q != null ? band.q : band.Q) : undefined,"
);

// L18897, 18901, 18908, 19174-19200, 19243, 19250, 19251, 19261, 19287:
code = code.replace("normalize(item.text ?? '')", "normalize(item.text != null ? item.text : '')");
code = code.replace("normalize(item.text ?? '')", "normalize(item.text != null ? item.text : '')");
code = code.replace("normalize(item.text ?? '')", "normalize(item.text != null ? item.text : '')");
code = code.replace("normalize(item.text ?? '')", "normalize(item.text != null ? item.text : '')");

code = code.replace(
  "rawSynced = normalizeLyricPublishText(lyrObj.syncedLyrics ?? lyrObj.synced_lyrics ?? lyrObj.lrc ?? '');",
  "rawSynced = normalizeLyricPublishText(lyrObj.syncedLyrics != null ? lyrObj.syncedLyrics : (lyrObj.synced_lyrics != null ? lyrObj.synced_lyrics : (lyrObj.lrc != null ? lyrObj.lrc : '')));"
);

code = code.replace(
  "const rawSynced = lyrObj.syncedLyrics ?? lyrObj.synced_lyrics ?? lyrObj.lrc ?? '';\n        const rawPlain = lyrObj.plainLyrics ?? lyrObj.plain_lyrics ?? lyrObj.plain ?? '';",
  "const rawSynced = lyrObj.syncedLyrics != null ? lyrObj.syncedLyrics : (lyrObj.synced_lyrics != null ? lyrObj.synced_lyrics : (lyrObj.lrc != null ? lyrObj.lrc : ''));\n        const rawPlain = lyrObj.plainLyrics != null ? lyrObj.plainLyrics : (lyrObj.plain_lyrics != null ? lyrObj.plain_lyrics : (lyrObj.plain != null ? lyrObj.plain : ''));"
);

code = code.replace(
  "trackMeta.trackName ?? trackMeta.track_name ?? trackMeta.title ?? trackMeta.name ??\n      (lyrObj && lyrObj.metadata && lyrObj.metadata.title) ?? ''",
  "((trackMeta.trackName != null ? trackMeta.trackName : (trackMeta.track_name != null ? trackMeta.track_name : (trackMeta.title != null ? trackMeta.title : trackMeta.name))) != null ? (trackMeta.trackName != null ? trackMeta.trackName : (trackMeta.track_name != null ? trackMeta.track_name : (trackMeta.title != null ? trackMeta.title : trackMeta.name))) : ((lyrObj && lyrObj.metadata && lyrObj.metadata.title) != null ? lyrObj.metadata.title : ''))"
);

code = code.replace(
  "trackMeta.artistName ?? trackMeta.artist_name ?? trackMeta.artist ??\n      (lyrObj && lyrObj.metadata && lyrObj.metadata.artist) ?? ''",
  "((trackMeta.artistName != null ? trackMeta.artistName : (trackMeta.artist_name != null ? trackMeta.artist_name : trackMeta.artist)) != null ? (trackMeta.artistName != null ? trackMeta.artistName : (trackMeta.artist_name != null ? trackMeta.artist_name : trackMeta.artist)) : ((lyrObj && lyrObj.metadata && lyrObj.metadata.artist) != null ? lyrObj.metadata.artist : ''))"
);

code = code.replace(
  "trackMeta.albumName ?? trackMeta.album_name ?? trackMeta.album ??\n      (lyrObj && lyrObj.metadata && lyrObj.metadata.album) ?? ''",
  "((trackMeta.albumName != null ? trackMeta.albumName : (trackMeta.album_name != null ? trackMeta.album_name : trackMeta.album)) != null ? (trackMeta.albumName != null ? trackMeta.albumName : (trackMeta.album_name != null ? trackMeta.album_name : trackMeta.album)) : ((lyrObj && lyrObj.metadata && lyrObj.metadata.album) != null ? lyrObj.metadata.album : ''))"
);

code = code.replace(
  `opts.decodedDurationSec ??
      opts.audioBuffer ??
      trackMeta.decodedDuration ??
      trackMeta.decodedDurationSec ??
      trackMeta.audioDuration ??`,
  `[opts.decodedDurationSec, opts.audioBuffer, trackMeta.decodedDuration, trackMeta.decodedDurationSec, trackMeta.audioDuration].find(x => x != null) ??`
);

// L19287: overrunToleranceMs
code = code.replace(
  "overrunToleranceMs: opts.overrunToleranceMs ?? opts.toleranceMs,",
  "overrunToleranceMs: opts.overrunToleranceMs != null ? opts.overrunToleranceMs : opts.toleranceMs,"
);

// L19788:
code = code.replace("const s = String(str ?? '');", "const s = String(str != null ? str : '');");

// L24592:
code = code.replace(
  "const direct = headersObj.get(targetName) ?? headersObj.get(lowerTarget);",
  "const d1 = headersObj.get(targetName);\n      const direct = d1 != null ? d1 : headersObj.get(lowerTarget);"
);

// L24659:
code = code.replace(
  "const rawKnownSize = opts.knownSize ?? opts.fileSize ?? (source && typeof source === 'object' ? (source.knownSize ?? source.fileSize) : undefined);",
  "const srcSize = source && typeof source === 'object' ? (source.knownSize != null ? source.knownSize : source.fileSize) : undefined;\n    const rawKnownSize = opts.knownSize != null ? opts.knownSize : (opts.fileSize != null ? opts.fileSize : srcSize);"
);

// L26398, 26431:
code = code.replace(
  "const ts = normalizeVaultEpochMs(nowOverride, true) ?? normalizeVaultEpochMs(nowFn(), false);",
  "const ts1 = normalizeVaultEpochMs(nowOverride, true);\n      const ts = ts1 != null ? ts1 : normalizeVaultEpochMs(nowFn(), false);"
);
code = code.replace(
  "const nowMs = normalizeVaultEpochMs(nowOverride, true) ?? normalizeVaultEpochMs(nowFn(), false);",
  "const nm1 = normalizeVaultEpochMs(nowOverride, true);\n      const nowMs = nm1 != null ? nm1 : normalizeVaultEpochMs(nowFn(), false);"
);

// L26743:
code = code.replace(
  "damping: Math.max(0, Math.min(1, Number(profile.damping ?? 0.4))),",
  "damping: Math.max(0, Math.min(1, Number(profile.damping != null ? profile.damping : 0.4))),"
);

// L26882-26886:
code = code.replace(
  `gainL = Number.isFinite(Number(item.gainL ?? item.leftGain))
          ? Number(item.gainL ?? item.leftGain)
          : Number(band.gainL || 0);
        gainR = Number.isFinite(Number(item.gainR ?? item.rightGain))
          ? Number(item.gainR ?? item.rightGain)`,
  `const rawGL = item.gainL != null ? item.gainL : item.leftGain;
        gainL = Number.isFinite(Number(rawGL))
          ? Number(rawGL)
          : Number(band.gainL || 0);
        const rawGR = item.gainR != null ? item.gainR : item.rightGain;
        gainR = Number.isFinite(Number(rawGR))
          ? Number(rawGR)`
);

// L26962:
code = code.replace(
  "dur:${spec.durationSec ?? 'auto'}",
  "dur:${spec.durationSec != null ? spec.durationSec : 'auto'}"
);

// L28208:
code = code.replace(
  "Math.floor(Number(fileSize !== undefined ? fileSize : (sourceOrId && (sourceOrId.fileSize ?? sourceOrId.size))) || 0)",
  "Math.floor(Number(fileSize !== undefined ? fileSize : (sourceOrId && (sourceOrId.fileSize != null ? sourceOrId.fileSize : sourceOrId.size))) || 0)"
);

// L28508, 28509:
code = code.replace(
  "const fileSize = Math.floor(Number(src.fileSize ?? src.size ?? opts.fileSize) || 0);\n    const metadataPointer = Math.floor(Number(src.metadataPointer ?? opts.metadataPointer) || 0);",
  "const fileSize = Math.floor(Number(src.fileSize != null ? src.fileSize : (src.size != null ? src.size : opts.fileSize)) || 0);\n    const metadataPointer = Math.floor(Number(src.metadataPointer != null ? src.metadataPointer : opts.metadataPointer) || 0);"
);

fs.writeFileSync(filePath, code, 'utf8');
console.log('Finished updating library-utils.js');
