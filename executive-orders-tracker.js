// executive-orders-tracker.js
import fetch from 'node-fetch';
import fs from 'fs/promises';

console.log('🏛️ EXECUTIVE ORDERS TRACKER');
console.log('============================\n');

// Generate simple ID
function generateId() {
    return Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

// Prompt definition (FIXED)
const EO_PROMPT = `Search for all U.S. Executive Orders issued between January 20, 2025 and today.

For each executive order, extract and return the following structured data in valid JSON format:
{
  "date": "YYYY-MM-DD",
  "title": "Full official title of the executive order",
  "order_number": "Executive Order number (e.g. EO 14001)",
  "summary": "2–3 sentence nonpartisan summary of what the order does and its intended impact",
  "impact_areas": ["e.g. immigration", "energy policy", "trade", "education"],
  "affected_agencies": ["List of federal departments or agencies involved"],
  "policy_direction": "expand | restrict | modify | create | eliminate",
  "severity_rating": "low | medium | high",
  "source_url": "Direct URL to official WhiteHouse.gov page",
  "full_text_available": true | false
}

Focus on categorizing each order by policy area. Prioritize orders related to:
- Immigration and border security (e.g. wall, deportations, asylum)
- Energy and environment (e.g. drilling, pipelines, climate rollback)
- Trade and tariffs (especially China, Mexico, WTO, USMCA)
- Defense and national security (DoD, NSA, cyber, border ops)
- Federal agency restructuring, appointments, or spending cuts
- Education, healthcare, and social policy (e.g. Title IX, ACA)
- Regulatory rollback or new enforcement measures

### Instructions:
- Include all orders, both major and minor — no filtering
- Include EOs issued on weekends, holidays, or same-day edits
- Only include EOs published or confirmed on whitehouse.gov
- Group amended or rescinded orders with the original, noting changes
- Return as a complete JSON array (even if over 20 results)`;

// Fetch executive orders from WhiteHouse.gov
async function fetchExecutiveOrders() {
    try {
        console.log('📋 Searching for recent Executive Orders...');

        const response = await fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                tools: [
                    {
                        type: 'web_search_preview',
                        search_context_size: 'large'
                    }
                ],
                input: [
                    {
                        role: 'user',
                        content: EO_PROMPT
                    }
                ],
                tool_choice: "auto",
                max_output_tokens: 3000
            })
        });

        if (!response.ok) {
            throw new Error(`OpenAI API error: ${response.status}`);
        }

        const data = await response.json();
        const content = data.output?.find(item => item.type === 'message')?.content?.[0]?.text || '';

        console.log(`  Response length: ${content.length}`);
        console.log(`  Tokens used: ${data.usage?.total_tokens || 'unknown'}`);

        // Extract JSON from response
        let orders = [];
        try {
            const jsonMatch = content.match(/\[[\s\S]*?\]/);
            if (jsonMatch) {
                orders = JSON.parse(jsonMatch[0]);
            }
        } catch (parseError) {
            console.log(`  ❌ Could not parse JSON response`);
            orders = [];
        }

        if (!Array.isArray(orders)) {
            orders = orders ? [orders] : [];
        }

        // Process and enhance orders
        const processedOrders = orders.map(order => {
            if (!order || typeof order !== 'object') return null;

            return {
                ...order,
                id: generateId(),
                type: 'executive_order',
                added_at: new Date().toISOString(),
                verified: order.source_url?.includes('whitehouse.gov') || false,
                date: order.date || new Date().toISOString().split('T')[0],
                category: categorizeExecutiveOrder(order),
                impact_score: assessImpact(order),
                implementation_status: 'issued',
                legal_challenges: [],
                related_orders: []
            };
        }).filter(order => order !== null && validateOrder(order));

        console.log(`  ✅ Found ${processedOrders.length} valid executive orders`);

        if (processedOrders.length > 0) {
            processedOrders.forEach((order, index) => {
                console.log(`    ${index + 1}. [${order.severity_rating.toUpperCase()}] ${order.title}`);
            });
        }

        return processedOrders;

    } catch (error) {
        console.error('❌ Error fetching executive orders:', error.message);
        return [];
    }
}

// Leave rest of file unchanged...
