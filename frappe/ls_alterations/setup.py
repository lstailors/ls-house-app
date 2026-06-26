from setuptools import setup, find_packages

with open("requirements.txt") as f:
    install_requires = f.read().strip().split("\n")

setup(
    name="ls_alterations",
    version="0.0.1",
    description="L&S Tailors — alterations, scanning, and operations app",
    author="L&S Tailors",
    author_email="tech@lstailors.com",
    packages=find_packages(),
    zip_safe=False,
    include_package_data=True,
    install_requires=install_requires,
)
