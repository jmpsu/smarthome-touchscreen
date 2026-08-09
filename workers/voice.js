// Voice command parsing (pure JavaScript, zero API cost)
export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    const { text, rooms, lights } = await request.json();
    const result = parseVoiceCommand(text, rooms || [], lights || []);

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
};

function parseVoiceCommand(text, rooms, lights) {
  const cmd = text.toLowerCase().trim();

  // Turn on/off "all lights"
  if (cmd.match(/turn\s+(on|off)\s+(all\s+)?lights/) || cmd.match(/lights?\s+(on|off)/)) {
    const action = cmd.includes('off') ? 'turn_off' : 'turn_on';
    return {
      action,
      entity_id: lights.length > 0 ? lights[0] : null,
      all_lights: true,
      entities: lights
    };
  }

  // Turn on/off specific room or light
  const roomMatch = cmd.match(/(kitchen|bedroom|living|bath|office|garage|patio|den|laundry|master|guest)\s+(lights?|lamp)/i);
  if (roomMatch) {
    const room = roomMatch[1].toLowerCase();
    const action = cmd.includes('off') ? 'turn_off' : 'turn_on';
    const entity = lights.find(l => l.includes(room)) || lights[0];
    return { action, entity_id: entity, room };
  }

  // Brightness "dim to 50%" or "dim by 20%"
  if (cmd.match(/dim/i)) {
    const percent = cmd.match(/(\d+)%?/)?.[1] || '50';
    const brightness = Math.round((parseInt(percent) / 100) * 255);
    return {
      action: 'brightness',
      entity_id: lights[0],
      brightness: Math.max(0, Math.min(255, brightness))
    };
  }

  // Color commands
  const colorMatch = cmd.match(/(red|blue|green|yellow|white|warm|cool|orange|purple)\s+light/i);
  if (colorMatch) {
    const color = colorMatch[1].toLowerCase();
    const colorMap = {
      'red': 'rgb(255,0,0)',
      'blue': 'rgb(0,0,255)',
      'green': 'rgb(0,255,0)',
      'yellow': 'rgb(255,255,0)',
      'white': 'rgb(255,255,255)',
      'warm': 'rgb(255,200,100)',
      'cool': 'rgb(100,150,255)',
      'orange': 'rgb(255,165,0)',
      'purple': 'rgb(128,0,255)'
    };
    return {
      action: 'color',
      entity_id: lights[0],
      color: colorMap[color] || 'rgb(255,255,255)'
    };
  }

  return { error: `Couldn't parse: "${text}"`, suggestion: 'Try: turn on kitchen lights, dim to 50%, or turn off all lights' };
}
