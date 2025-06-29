import fetch from 'node-fetch';

// SIMPLE TEST: Can the OpenAI API actually find recent news?
const SIMPLE_NEWS_TEST = `Find any news story from today, June 29, 2025, about Donald Trump. Return the headline and source.`;

async function testAPINewsCapability() {
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    console.error('OpenAI API key not found');
    return;
  }

  console.log('=== TESTING: Can OpenAI API Find Real News? ===');
  console.log('Prompt:', SIMPLE_NEWS_TEST);
  
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: SIMPLE_NEWS_TEST
          }
        ],
        max_tokens: 500,
        temperature: 0.3
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content.trim();
    
    console.log('\n=== API RESPONSE ===');
    console.log('Length:', content.length);
    console.log('Tokens used:', data.usage?.total_tokens || 'unknown');
    console.log('Content:');
    console.log(content);
    console.log('==================');

    // Analyze the response
    if (content.toLowerCase().includes('i don\'t have access') || 
        content.toLowerCase().includes('cannot browse') ||
        content.toLowerCase().includes('knowledge cutoff') ||
        content.toLowerCase().includes('real-time')) {
      console.log('\n❌ RESULT: API Cannot Access Real News');
    } else if (content.includes('June 29, 2025') || content.includes('today')) {
      console.log('\n✅ RESULT: API Might Have News Access');
    } else {
      console.log('\n❓ RESULT: Unclear - needs manual review');
    }

  } catch (error) {
    console.error('Error testing API:', error.message);
  }
}

testAPINewsCapability();
