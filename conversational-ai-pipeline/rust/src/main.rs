/// Example usage of the model runtime
use model_runtime::{create_runtime, ModelRuntime};
use candle_core::{Device, Tensor};
use anyhow::Result;

fn main() -> Result<()> {
    // Initialize logging
    tracing_subscriber::fmt::init();

    // Example 1: Load a model from configuration
    println!("Loading model from configuration...");
    
    let model_dir = "./examples";
    let config_path = "transformer_model.yaml";
    
    // Try to create runtime (will fail if model files don't exist, but shows usage)
    match create_runtime(model_dir, config_path, None) {
        Ok(runtime) => {
            println!("Model loaded successfully!");
            println!("Model: {}", runtime.config().metadata.name);
            println!("Architecture: {:?}", runtime.config().architecture);
            
            // Example inference (would need actual model weights)
            // let input = Tensor::zeros(&[1, 768], runtime.device())?;
            // let output = runtime.infer(&input)?;
            // println!("Inference completed!");
        }
        Err(e) => {
            println!("Note: Model loading failed (expected if model files don't exist): {}", e);
            println!("\nTo use this example:");
            println!("1. Create a model directory with weights");
            println!("2. Place your config.yaml file in that directory");
            println!("3. Update the paths in this example");
        }
    }

    Ok(())
}

