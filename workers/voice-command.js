/**
 * voice-command.js — Cloudflare Worker
 * Parses natural language voice commands via local regex + Claude Haiku fallback
 * Returns {action, entity_id, brightness, color, room}
 */

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      const { text, rooms, lights } = await request.json();
      if (!text) return json({ error: 'No text provided' }, 400);

      // Try local regex parsing first (zero API cost)
      const localResult = parseCommandLocal(text, rooms, lights);
      if (localResult) return json(localResult);

      // Fallback to Claude Haiku if needed
      if (!env.CLAUDE_API_KEY) {
        return json({ error: 'Claude API key not configured' }, 500);
      }

      const claudeResult = await parseCommandClaude(text, rooms, lights, env.CLAUDE_API_KEY);
      return json(claudeResult);
    } catch (error) {
      console.error('Voice command error:', error);
      return json({ error: error.message }, 500);
    }
  }
};

function parseCommandLocal(text, rooms = [], lights = []) {
  const cmd = text.toLowerCase().trim();

  // "turn off all lights"
  if (/turn\s+(off|on)\s+all\s+(lights?|switches?)/.test(cmd)) {
    return {
      action: /off/.test(cmd) ? 'turn_off' : 'turn_on',
      entity_id: lights[0],
      all: true
    };
  }

  // "turn off kitchen lights"
  const roomMatch = cmd.match(/turn\s+(off|on)\s+(?:the\s+)?(\w+)\s+(lights?|switches?)/);
  if (roomMatch) {
    const [, action, room] = roomMatch;
    const entity = findEntityByRoom(room, lights);
    return entity ? {
      action: action === 'off' ? 'turn_off' : 'turn_on',
      entity_id: entity
    } : null;
  }

  // "dim by 20%"
  const dimMatch = cmd.match(/dim\s+(?:by\s+)?(\d+)%?/);
  if (dimMatch) {
    const percent = parseInt(dimMatch[1]);
    return {
      action: 'brightness',
      entity_id: lights[0],
      brightness: Math.max(0, Math.min(255, Math.round((percent / 100) * 255)))
    };
  }

  // "brightness 50%"
  const brightMatch = cmd.match(/brightness\s+(\d+)%?/);
  if (brightMatch) {
    return {
      action: 'brightness',
      entity_id: lights[0],
      brightness: Math.round((parseInt(brightMatch[1]) / 100) * 255)
    };
  }

  // "warm / cool"
  if (/warm|cool|color temp/.test(cmd)) {
    const isWarm = /warm/.test(cmd);
    return {
      action: 'color_temp',
      entity_id: lights[0],
      color_temp: isWarm ? 2700 : 5000
    };
  }

  return null;
}

function findEntityByRoom(room, lights) {
  return lights.find(entity => entity.includes(room)) || lights[0];
}

async function parseCommandClaude(text, rooms, lights, apiKey) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 50,
      messages: [{
        role: 'user',
        content: `Parse this smart home command and respond ONLY with valid JSON (no markdown, no explanation).
Command: "${text}"
Available rooms: ${rooms.join(', ')}
Available lights: ${lights.join(', ')}
Response format: {"action": "turn_on|turn_off|brightness|color_temp|color", "entity_id": "light.xxx", "brightness": 0-255, "color_temp": 2700-6500}`
      }]
    })
  });

  const result = await response.json();
  if (!response.ok) {
    console.error('Claude error:', result);
    return { error: 'Claude parsing failed' };
  }

  try {
    const text = result.content[0].text;
    return JSON.parse(text);
  } catch {
    return { error: 'Failed to parse response' };
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}
