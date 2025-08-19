from transformers import AutoProcessor, Pix2StructForConditionalGeneration



class Pix2struct:
    def __init__(self):
        self.processor = AutoProcessor.from_pretrained("google/pix2struct-textcaps-base")
        self.model = Pix2StructForConditionalGeneration.from_pretrained("google/pix2struct-textcaps-base")
        
        self.proc

        self.prompt = '''Attached is an image of the current frame, and details regrading what appeared during the last frame. 
        What changed from the last frame?'''
        self.memory = []






    def generate_text(self, frame, prompt):

        inputs = self.processor(text=prompt, images=frame, return_tensors="pt", add_special_tokens=False)
        id = self.model.generate(**inputs)
        return self.processor.batch_decode(id, skip_special_tokens=True)[0]




    def run(self, frame):
        pass