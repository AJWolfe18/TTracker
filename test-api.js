// Quick test of Federal Register API parameters
async function testAPI() {
    const today = '2025-08-08';
    
    // Test the new API call
    const apiUrl = `https://www.federalregister.gov/api/v1/articles.json` + 
                   `?conditions[type]=PRESDOCU` +
                   `&conditions[presidential_document_type_id]=2` +
                   `&conditions[publication_date][gte]=2025-01-20` +
                   `&conditions[publication_date][lte]=${today}` +
                   `&fields[]=title&fields[]=executive_order_number` +
                   `&order=signing_date&per_page=20`;
    
    console.log('🧪 Testing API URL:');
    console.log(apiUrl);
    console.log('\n🔍 Results:');
    
    try {
        const response = await fetch(apiUrl);
        const data = await response.json();
        
        console.log(`✅ Total count: ${data.count}`);
        console.log(`✅ Results returned: ${data.results?.length || 0}`);
        
        if (data.results && data.results.length > 0) {
            console.log('\n📋 Sample results:');
            data.results.slice(0, 3).forEach((item, i) => {
                console.log(`  ${i+1}. ${item.title}`);
                console.log(`     EO Number: ${item.executive_order_number || 'None'}`);
            });
        }
        
        // Test without the presidential_document_type_id for comparison
        console.log('\n🔍 Testing without presidential_document_type_id filter:');
        const oldApiUrl = apiUrl.replace('&conditions[presidential_document_type_id]=2', '');
        const oldResponse = await fetch(oldApiUrl);
        const oldData = await oldResponse.json();
        console.log(`📊 Without filter: ${oldData.count} total documents`);
        console.log(`📊 With filter: ${data.count} executive orders`);
        
    } catch (error) {
        console.log(`❌ Error: ${error.message}`);
    }
}

testAPI();