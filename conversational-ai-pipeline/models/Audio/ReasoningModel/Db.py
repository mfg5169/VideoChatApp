from transformers import AutoTokenizer, AutoModelForCausalLM
import torch
import os

# Get token from environment variable (recommended) or replace with your actual token
HF_TOKEN = os.getenv("HF_TOKEN", "hf_YOUR_TOKEN")  # Replace with your actual token

try:
    print("Loading tokenizer...")
    tokenizer = AutoTokenizer.from_pretrained("databricks/dbrx-instruct", token=HF_TOKEN)
    print("Tokenizer loaded successfully!")
    
    print("Loading model...")
    model = AutoModelForCausalLM.from_pretrained("databricks/dbrx-instruct", device_map="auto", torch_dtype=torch.bfloat16, token=HF_TOKEN)
    print("Model loaded successfully!")
    
except Exception as e:
    print(f"Error loading model: {e}")
    print("This might be due to:")
    print("1. Invalid or missing Hugging Face token")
    print("2. Insufficient permissions for the databricks/dbrx-instruct model")
    print("3. Need to request access to the model at https://huggingface.co/databricks/dbrx-instruct")
    exit(1)

input_text = "What does it take to build a great LLM?"
messages = [{"role": "user", "content": input_text}]
input_ids = tokenizer.apply_chat_template(messages, return_dict=True, tokenize=True, add_generation_prompt=True, return_tensors="pt")

outputs = model.generate(**input_ids, max_new_tokens=200)
print(tokenizer.decode(outputs[0]))
