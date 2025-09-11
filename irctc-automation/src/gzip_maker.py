import gzip
import shutil

with open(r"D:\Freelancing\IRCTC Automation\TatkalSniper\irctc-automation\tessdata\eng.traineddata", "rb") as f_in:
    with gzip.open("eng.traineddata.gz", "wb") as f_out:
        shutil.copyfileobj(f_in, f_out)
