"""
Example script for registering external models with the agent.
"""

from langchain import create_agent

def main():
    # Create agent
    agent = create_agent()
    
    # Register ONNX model
    agent.register_external_model(
        model_name="image_classifier",
        model_type="onnx",
        model_path="./models/image_classifier.onnx"
    )
    
    # Register Rust model
    agent.register_external_model(
        model_name="text_processor",
        model_type="rust",
        model_path="./rust/models/text_model",
        config_path="./rust/models/text_model/config.yaml"
    )
    
    # Register C++ model
    agent.register_external_model(
        model_name="video_analyzer",
        model_type="cpp",
        model_path="./cpp_models/video_model",
        config_path=None  # C++ models use binary path in config
    )
    
    # List registered models
    print("Registered models:")
    for model_name in agent.list_available_models():
        print(f"  - {model_name}")
    
    # Example usage
    result = agent.invoke(
        "Analyze this image using the image_classifier model",
        image_paths=["./test_image.png"]
    )
    
    print("\nAgent response:")
    print(result)

if __name__ == "__main__":
    main()

