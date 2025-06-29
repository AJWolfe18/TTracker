import fetch from 'node-fetch';

console.log('=== TESTING WEB SEARCH API CAPABILITY ===');
console.log('Date:', new Date().toDateString());

async function testWebSearchAPI() {
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    throw new Error('OpenAI API key not found');
  }

  // Test 1: Try with web search tool
  console.log('\n=== TEST 1: Web Search Tool ===');
  try {
    const response1 = await fetch('https://api.openai.com/v1/chat/completions', {
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
            content: 'Find current news about Donald Trump from today, June 29, 2025'
          }
        ],
        tools: [
          {
            type: 'web_search_preview',
            search_context_size: 'low'
          }
        ],
        max_tokens: 500
      }),
    });

    if (response1.ok) {
      const data1 = await response1.json();
      console.log('✅ Web search tool WORKS!');
      console.log('Response:', data1.choices[0].message.content.substring(0, 200) + '...');
      console.log('Tokens used:', data1.usage?.total_tokens);
      return true;
    } else {
      const error1 = await response1.json();
      console.log('❌ Web search tool failed:', error1.error?.message);
    }
  } catch (error) {
    console.log('❌ Web search tool error:', error.message);
  }

  // Test 2: Try with GPT-4.1 model
  console.log('\n=== TEST 2: GPT-4.1 Model ===');
  try {
    const response2 = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4.1',
        messages: [
          {
            role: 'user',
            content: 'Find current news about Donald Trump from today'
          }
        ],
        max_tokens: 500
      }),
    });

    if (response2.ok) {
      const data2 = await response2.json();
      console.log('✅ GPT-4.1 model available!');
      console.log('Response:', data2.choices[0].message.content.substring(0, 200) + '...');
      console.log('Tokens used:', data2.usage?.total_tokens);
      return true;
    } else {
      const error2 = await response2.json();
      console.log('❌ GPT-4.1 not available:', error2.error?.message);
    }
  } catch (error) {
    console.log('❌ GPT-4.1 error:', error.message);
  }

  // Test 3: Check available models
  console.log('\n=== TEST 3: Available Models ===');
  try {
    const response3 = await fetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (response3.ok) {
      const data3 = await response3.json();
      const models = data3.data.map(m => m.id).filter(id => id.includes('gpt-4'));
      console.log('Available GPT-4 models:', models);
      
      const hasWebSearch = models.some(m => m.includes('4.1') || m.includes('4o'));
      if (hasWebSearch) {
        console.log('✅ You have access to models that support web search!');
      } else {
        console.log('❌ No web search capable models available');
      }
    }
  } catch (error) {
    console.log('❌ Error checking models:', error.message);
  }

  return false;
}

async function main() {
  const hasWebSearch = await testWebSearchAPI();
  
  console.log('\n=== SUMMARY ===');
  if (hasWebSearch) {
    console.log('🎉 Web search IS available! You can get real news!');
    console.log('Next step: Update your tracker to use web search');
  } else {
    console.log('❌ Web search not available with your current API access');
    console.log('Options:');
    console.log('1. Add Google Custom Search API');
    console.log('2. Use RSS feeds');
    console.log('3. Manual + AI hybrid approach');
  }
}

main();
