#!/bin/bash

# Activate the virtual environment for the conversational-ai-pipeline project

# Check if script is being sourced or executed
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    # Script is being executed directly (not sourced)
    echo "This script must be sourced to activate the virtual environment in your current shell."
    echo ""
    echo "Please run one of the following commands:"
    echo "  source activate_env.sh"
    echo "  . activate_env.sh"
    echo ""
    echo "Or if you're in a different directory:"
    echo "  source /path/to/activate_env.sh"
    exit 1
fi

# Script is being sourced, proceed with activation
echo "Checking if you're in the right directory..."

# Check if we're in the right directory
if [ ! -d "venv" ]; then
    echo "Error: venv directory not found. Make sure you're in the conversational-ai-pipeline directory."
    return 1 2>/dev/null || exit 1
fi

echo "Activating virtual environment..."
# Activate the virtual environment
source venv/bin/activate

echo "Virtual environment activated!"
echo "You can now run: python main.py"
echo ""
echo "To deactivate, run: deactivate"
