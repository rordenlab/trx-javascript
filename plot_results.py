import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns

# Load the TSV file
file_path = "results.tsv"  # Update the path if needed
df = pd.read_csv(file_path, sep="\t", header=None, usecols=[0, 2, 4], names=["Format", "Size", "Time"])

# Normalize size for better visualization in plot
df["ScaledSize"] = df["Size"] / df["Size"].max() * 300  # Scale size for visibility

# Create the plot with Seaborn
plt.figure(figsize=(10, 6), dpi=300)  # Fixed resolution for reproducibility
sns.scatterplot(
    data=df, 
    x="Time", 
    y="Size", 
    size="ScaledSize",
    hue="Format",
    palette="bright",
    sizes=(50, 1000),
    alpha=0.7,
    edgecolor="black"
)

# Improve plot readability
plt.xscale("log")  # Log scale for better distribution
plt.yscale("log")
plt.xlabel("Time (ms)")
plt.ylabel("Size (bytes)")
plt.title("File Size vs. Processing Time")
legend = plt.legend(bbox_to_anchor=(1.05, 1), loc="upper left")
for text in legend.get_texts():
    if "ScaledSize" in text.get_text() or "Format" in text.get_text():
        text.set_fontweight("bold")

# Save plot to disk
output_path = "file_size_vs_time.png"
plt.savefig(output_path, bbox_inches="tight", dpi=300)

print(f"Plot saved as {output_path}")
