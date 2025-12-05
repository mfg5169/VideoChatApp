/// Model Runtime - A framework for loading and running neural network models in Rust.
/// 
/// This library provides:
/// - Model configuration parsing (YAML/JSON)
/// - Weight loading from various formats
/// - Architecture reconstruction
/// - Fast inference runtime

pub mod config;
pub mod loader;
pub mod architectures;
pub mod runtime;

pub use config::{
    ModelConfig, ArchitectureType, LayerConfig, WeightConfig,
    ModelMetadata, Hyperparameters, TokenizerConfig,
    PreprocessingConfig, PostprocessingConfig,
};
pub use loader::ModelLoader;
pub use architectures::{ArchitectureBuilder, Model, ArchitectureRegistry};
pub use runtime::{ModelRuntime, AsyncModelRuntime};

use candle_core::Device;
use anyhow::Result;

/// Create a model runtime from a configuration file
/// 
/// # Arguments
/// * `model_dir` - Directory containing model files
/// * `config_path` - Path to configuration file (relative to model_dir)
/// * `device` - Optional device (CPU, CUDA, etc.). Defaults to CPU.
/// 
/// # Example
/// ```no_run
/// use model_runtime::create_runtime;
/// 
/// let runtime = create_runtime("./models/my_model", "config.yaml", None)?;
/// ```
pub fn create_runtime<P: AsRef<std::path::Path>>(
    model_dir: P,
    config_path: &str,
    device: Option<Device>,
) -> Result<ModelRuntime> {
    ModelRuntime::from_config(model_dir, config_path, device)
}

/// Create a model runtime with CUDA device if available
pub fn create_runtime_cuda<P: AsRef<std::path::Path>>(
    model_dir: P,
    config_path: &str,
) -> Result<ModelRuntime> {
    let device = if candle_core::utils::cuda_is_available() {
        Device::new_cuda(0)?
    } else {
        Device::Cpu
    };
    create_runtime(model_dir, config_path, Some(device))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_loading() {
        // This would test config loading with a sample config
        // For now, just a placeholder
    }
}

