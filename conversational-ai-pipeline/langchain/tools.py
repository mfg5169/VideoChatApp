"""
Tools for the conversational agent.
Includes search tools, memory tools, and other agentic capabilities.
"""

from langchain_core.tools import tool
from langchain_community.tools import DuckDuckGoSearchRun, WikipediaQueryRun
from langchain_community.utilities import WikipediaAPIWrapper, DuckDuckGoSearchAPIWrapper
from typing import Optional, List, Dict, Any
import requests
from datetime import datetime


# Initialize search tools
duckduckgo_search = DuckDuckGoSearchRun()
wikipedia_search = WikipediaQueryRun(api_wrapper=WikipediaAPIWrapper())


@tool
def web_search(query: str) -> str:
    """
    Search the web for current information using DuckDuckGo.
    Use this tool when you need to find recent information, news, or facts that may not be in your training data.
    
    Args:
        query: The search query string
    
    Returns:
        Search results as a string
    """
    try:
        results = duckduckgo_search.run(query)
        return results
    except Exception as e:
        return f"Error performing web search: {str(e)}"


@tool
def wikipedia_search(query: str) -> str:
    """
    Search Wikipedia for detailed information about a topic.
    Use this tool when you need comprehensive, factual information about well-known topics.
    
    Args:
        query: The Wikipedia search query
    
    Returns:
        Wikipedia article summary or search results
    """
    try:
        results = wikipedia_search.run(query)
        return results
    except Exception as e:
        return f"Error searching Wikipedia: {str(e)}"


@tool
def search_long_term_memory(query: str, k: int = 5) -> str:
    """
    Search the agent's long-term memory for relevant past conversations and stored information.
    Use this tool when you need to recall information from previous interactions with the user.
    
    Args:
        query: The search query to find relevant memories
        k: Number of results to return (default: 5)
    
    Returns:
        Formatted string of relevant memories
    """
    # This will be injected by the agent at runtime
    # The agent should pass the memory_manager instance
    return "Memory search tool - requires memory_manager instance"


@tool
def store_important_fact(fact: str, category: Optional[str] = None) -> str:
    """
    Store an important fact or piece of information in long-term memory.
    Use this tool when the user shares important information that should be remembered for future conversations.
    
    Args:
        fact: The fact or information to store
        category: Optional category for the fact (e.g., "preference", "personal_info", "task")
    
    Returns:
        Confirmation message
    """
    # This will be injected by the agent at runtime
    return "Memory storage tool - requires memory_manager instance"


@tool
def get_current_time() -> str:
    """
    Get the current date and time.
    Use this tool when the user asks about the current time or date.
    
    Returns:
        Current date and time as a formatted string
    """
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


@tool
def calculate(expression: str) -> str:
    """
    Evaluate a mathematical expression.
    Use this tool when the user asks for calculations or mathematical operations.
    
    Args:
        expression: Mathematical expression as a string (e.g., "2 + 2", "10 * 5")
    
    Returns:
        Result of the calculation
    """
    try:
        # Safe evaluation of mathematical expressions
        allowed_chars = set("0123456789+-*/.() ")
        if not all(c in allowed_chars for c in expression):
            return "Error: Invalid characters in expression"
        
        result = eval(expression)
        return str(result)
    except Exception as e:
        return f"Error calculating: {str(e)}"


class ToolManager:
    """
    Manages all tools for the agent and provides dynamic tool injection.
    """
    
    def __init__(self, memory_manager=None):
        """
        Initialize tool manager.
        
        Args:
            memory_manager: Optional MemoryManager instance for memory tools
        """
        self.memory_manager = memory_manager
        self.base_tools = [
            web_search,
            wikipedia_search,
            get_current_time,
            calculate
        ]
    
    def get_tools(self) -> List:
        """
        Get all available tools, including memory tools if memory_manager is available.
        
        Returns:
            List of tool instances
        """
        tools = self.base_tools.copy()
        
        if self.memory_manager:
            # Create memory tools with access to memory_manager
            @tool
            def search_memory(query: str, k: int = 5) -> str:
                """Search long-term memory for relevant information."""
                memories = self.memory_manager.retrieve_relevant_memories(query, k=k)
                if not memories:
                    return "No relevant memories found."
                
                formatted_results = []
                for i, mem in enumerate(memories, 1):
                    formatted_results.append(
                        f"{i}. {mem['content']}\n   (Relevance: {1 - mem['score']:.2f})"
                    )
                
                return "\n\n".join(formatted_results)
            
            @tool
            def store_fact(fact: str, category: Optional[str] = None) -> str:
                """Store an important fact in long-term memory."""
                metadata = {"type": "fact", "timestamp": datetime.now().isoformat()}
                if category:
                    metadata["category"] = category
                
                self.memory_manager.long_term_memory.add_memory(fact, metadata=metadata)
                self.memory_manager.persist()
                return f"Stored fact: {fact}"
            
            tools.extend([search_memory, store_fact])
        
        return tools
    
    def update_memory_manager(self, memory_manager):
        """Update the memory manager instance."""
        self.memory_manager = memory_manager


# Default tool manager instance
default_tool_manager = ToolManager()

