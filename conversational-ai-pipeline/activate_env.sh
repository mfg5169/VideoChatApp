#!/bin/bash

# Activate the virtual environment for the conversational-ai-pipeline project
echo "Checking if you're in the right directory..."

# Check if we're in the right directory
if [ ! -d "venv" ]; then
    echo "Error: venv directory not found. Make sure you're in the conversational-ai-pipeline directory."
    exit 1
fi

echo "Activating virtual environment..."
# Activate the virtual environment
source venv/bin/activate

echo "Virtual environment activated!"
echo "You can now run: python main.py"
echo ""
echo "To deactivate, run: deactivate"
