/**
 * voice-command.js — Cloudflare Worker
 * Parses natural language voice commands via three-tier local matching (zero Claude dependency)
 * Tier 1: Regex pattern matching (~90% of commands)
 * Tier 2: Home Assistant entity fuzzy-match (room names, custom entities)
 * Tier 3: Agent-Reach web scraping fallback (edge cases)
 * Returns {action, entity_id, brightness, color, room, confidence}
 */

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      const { text, rooms = [], lights = [] } = await request.json();
      if (!text) return json({ error: 'No text provided' }, 400);

      // Tier 1: Local regex patterns (zero cost, instant)
      const t1Result = parseCommandTier1(text, rooms, lights);
      if (t1Result && t1Result.confidence >= 0.7) {
        return json({ ...t1Result, tier: 1 });
      }

      // Tier 2: Home Assistant entity fuzzy-match (zero cost, instant)
      const t2Result = parseCommandTier2(text, rooms, lights);
      if (t2Result && t2Result.confidence >= 0.7) {
        return json({ ...t2Result, tier: 2 });
      }

      // Tier 3: Agent-Reach scraping fallback (free if installed, optional)
      // Skip if not enabled to avoid extra latency
      if (env.AGENT_REACH_ENABLED === 'true') {
        const t3Result = await parseCommandTier3(text, rooms, lights, env);
        if (t3Result && t3Result.confidence >= 0.5) {
          return json({ ...t3Result, tier: 3 });
        }
      }

      // No match - return suggestions
      return json({
        error: 'Could not parse command',
        transcript: text,
        suggestions: [
          'Try: "turn on lights"',
          'Try: "dim by 20 percent"',
          'Try: "set brightness to 50"',
          'Try: "warm lights"',
          'Try: "turn off kitchen lights"'
        ]
      }, 400);
    } catch (error) {
      console.error('Voice command error:', error);
      return json({ error: error.message }, 500);
    }
  }
};

// ============ TIER 1: REGEX PATTERNS ============
function parseCommandTier1(text, rooms = [], lights = []) {
  const cmd = text.toLowerCase().trim();
  let confidence = 0;
  let action = null;
  let entity_id = null;
  let brightness = null;
  let color_temp = null;
  let color = null;

  // TOGGLE ACTIONS: on/off
  const toggleMatch = cmd.match(/\b(turn|switch|flip|activate|deactivate|set|put)\s+(off|on|toggle)\b/);
  if (toggleMatch) {
    const [, , state] = toggleMatch;
    action = state === 'off' ? 'turn_off' : state === 'on' ? 'turn_on' : 'toggle';
    entity_id = lights[0];
    confidence += 0.3;
  }

  // ALL LIGHTS
  if (/\b(all|every|entire|whole\s+house)\s+(lights?|switches?|devices?)\b/.test(cmd)) {
    confidence += 0.15;
    return { action, entity_id, all: true, confidence };
  }

  // BRIGHTNESS ABSOLUTE: "set brightness to 50" or "brightness 75%"
  const brightAbsMatch = cmd.match(/brightness\s+(?:to\s+)?(\d+)%?/);
  if (brightAbsMatch) {
    const percent = parseInt(brightAbsMatch[1]);
    action = 'brightness';
    brightness = Math.max(0, Math.min(255, Math.round((percent / 100) * 255)));
    entity_id = lights[0];
    confidence += 0.35;
  }

  // BRIGHTNESS RELATIVE: "dim by 20" or "brighten by 30"
  const brightRelMatch = cmd.match(/(dim|brighten|increase|decrease)\s+(?:by\s+)?(\d+)%?/);
  if (brightRelMatch) {
    const [, direction, percent] = brightRelMatch;
    const change = Math.round((parseInt(percent) / 100) * 255);
    action = direction === 'brighten' || direction === 'increase' ? 'brightness_up' : 'brightness_down';
    brightness = change;
    entity_id = lights[0];
    confidence += 0.35;
  }

  // COLOR TEMPERATURE: warm/cool/neutral/daylight
  const colorTempMatch = cmd.match(/\b(warm|cool|neutral|daylight|color\s+temp)\b/);
  if (colorTempMatch) {
    const [, temp] = colorTempMatch;
    action = 'color_temp';
    if (temp === 'warm') color_temp = 2700;
    else if (temp === 'cool') color_temp = 5000;
    else if (temp === 'neutral') color_temp = 4000;
    else if (temp === 'daylight') color_temp = 6500;
    entity_id = lights[0];
    confidence += 0.3;
  }

  // RGB COLORS: red, blue, green, white, orange, purple, pink
  const colorMatch = cmd.match(/\b(red|blue|green|white|orange|purple|pink|yellow)\b/);
  if (colorMatch) {
    const [, colorName] = colorMatch;
    action = 'color';
    color = colorName;
    entity_id = lights[0];
    confidence += 0.3;
  }

  // SCENES: movie, goodnight, good morning, relax, bedtime
  const sceneMatch = cmd.match(/\b(movie\s+mode|goodnight|good\s+morning|relax|bedtime|wake\s+up)\b/);
  if (sceneMatch) {
    action = 'scene';
    entity_id = sceneMatch[1].replace(/\s+/g, '_').toLowerCase();
    confidence += 0.4;
  }

  // Return if any action matched
  if (action) {
    return {
      action,
      entity_id,
      brightness,
      color_temp,
      color,
      confidence
    };
  }

  return null;
}

// ============ TIER 2: ENTITY FUZZY-MATCH ============
function parseCommandTier2(text, rooms = [], lights = []) {
  const cmd = text.toLowerCase().trim();
  let confidence = 0;

  // Try to match room names against available entities
  for (const room of rooms) {
    if (cmd.includes(room.toLowerCase())) {
      // Found a room mention, extract action
      if (/turn\s+(off|on)/.test(cmd)) {
        const action = /off/.test(cmd) ? 'turn_off' : 'turn_on';
        const matchedLight = lights.find(l => l.includes(room)) || lights[0];
        return {
          action,
          entity_id: matchedLight,
          room,
          confidence: 0.75
        };
      }
    }
  }

  // Fuzzy match entity names (simple edit distance)
  for (const light of lights) {
    const similarity = levenshteinSimilarity(cmd, light.toLowerCase());
    if (similarity > 0.6) {
      return {
        action: 'toggle',
        entity_id: light,
        confidence: similarity
      };
    }
  }

  return null;
}

// ============ TIER 3: AGENT-REACH FALLBACK ============
async function parseCommandTier3(text, rooms, lights, env) {
  // Placeholder for Agent-Reach integration
  // Would scrape HA dashboard and match against discovered UI elements
  // For now, return null to skip
  return null;
}

// ============ UTILITIES ============
function levenshteinSimilarity(str1, str2) {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix = Array(len2 + 1).fill(null).map(() => Array(len1 + 1).fill(0));

  for (let i = 0; i <= len1; i++) matrix[0][i] = i;
  for (let j = 0; j <= len2; j++) matrix[j][0] = j;

  for (let j = 1; j <= len2; j++) {
    for (let i = 1; i <= len1; i++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + cost
      );
    }
  }

  const distance = matrix[len2][len1];
  const maxLen = Math.max(len1, len2);
  return 1 - (distance / maxLen);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}
