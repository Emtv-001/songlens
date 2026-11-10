"""Checks that the Python side of SongLens analysis can run on this machine.

Usage:
    python check_env.py                 # checks the libraries
    python check_env.py my-song.mp3   # also tries to read an audio file
"""
import sys


def main():
    try:
        import numpy
        import scipy
        import soundfile
    except ImportError as err:
        print(f"MISSING LIBRARY: {err}")
        return 1

    print(f"python     {sys.version.split()[0]}")
    print(f"numpy      {numpy.__version__}")
    print(f"scipy      {scipy.__version__}")
    print(f"soundfile  {soundfile.__version__}")
    print(f"libsndfile {soundfile.__libsndfile_version__}")
    formats = soundfile.available_formats()
    print(f"formats    {', '.join(sorted(formats))}")
    print(f"MP3 support: {'yes' if 'MP3' in formats else 'NO'}")

    if len(sys.argv) > 1:
        path = sys.argv[1]
        try:
            data, rate = soundfile.read(path, dtype="float32", always_2d=True)
        except Exception as err:  # noqa: BLE001 - report any decoding problem
            print(f"COULD NOT READ {path}: {err}")
            return 2
        seconds = data.shape[0] / rate
        print(f"read {path}: {seconds:.1f} s, {rate} Hz, {data.shape[1]} channel(s)")

    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())