# from websockets.sync.serverimportserve
# import json
# import base64
# from concurrent.futuresimportThreadPoolExecutor

# from models.VADimportWebRtCasVAD 
# from models.Whisperimporttranscribe_bytes
# from models.Wav2Vec2EMimportrecognize_emotion_from_bytes,get_emotion_labels

# vad= VAD(aggressiveness=3)
# executor=ThreadPoolExecutor(max_workers=4)

# def process_audio_chunk(message):
#    try:
#        audio_bytes=base64.b64decode(message)
#        speech_detected=vad.is_speech(audio_bytes)
#        
#        ifspeech_detected:
#            transcription=transcribe_bytes(audio_bytes)
#            emotion_result=recognize_emotion_from_bytes(audio_bytes)
#            
#            response={
#                "speech_detected":True,
#                "transcription":transcription,
#                "emotion":emotion_result
#            }
#        else:
#            response={"speech_detected":False}
#        
#        returnresponse
#    
#    exceptExceptionase:
#        print(f"Errorprocessingaudio:{e}")
#        return{"error":str(e)}

# defstart_websocket_server(websocket):
#    print("Clientconnected")
#    print("Availableemotions:",",".join(get_emotion_labels()))
#    
#    forraw_messageinwebsocket:
#        future=executor.submit(process_audio_chunk,raw_message)
#        result=future.result()
#        
#        if"error"inresult:
#            websocket.send(json.dumps(result))
#        elifresult.get("speech_detected"):
#            websocket.send(json.dumps(result))

# if__name__=="__main__":
#    withserve(start_websocket_server,"localhost",8765)asserver:
#        print("WebSocketserverstartedatws://localhost:8765")
#        server.serve_forever() 