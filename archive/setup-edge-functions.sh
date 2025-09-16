#!/bin/bash
# Setup script for Supabase Edge Functions

echo "========================================="
echo "SUPABASE EDGE FUNCTIONS SETUP"
echo "========================================="
echo ""

# Check if Supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI not found!"
    echo "Please install it first:"
    echo "  npm install -g supabase"
    exit 1
fi

echo "✅ Supabase CLI found"
echo ""

# Initialize Supabase if not already done
if [ ! -f "supabase/config.toml" ]; then
    echo "Initializing Supabase project..."
    supabase init
fi

# Link to project
echo "Linking to Supabase project..."
echo "Enter your database password when prompted:"
supabase link --project-ref wnrjrywpcadwutfykflu

# Start Supabase locally
echo ""
echo "Starting local Supabase..."
supabase start

# Serve functions locally
echo ""
echo "Starting Edge Functions server..."
echo "Functions will be available at:"
echo "  http://localhost:54321/functions/v1/[function-name]"
echo ""
echo "Press Ctrl+C to stop"
supabase functions serve